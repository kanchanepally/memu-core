import { pool } from '../db/connection';
import { getSkill, renderTemplate, type Skill, type SkillModel, type SkillCostTier } from './loader';
import {
  callClaude,
  type ClaudeCallInput,
  type ClaudeContentBlock,
  type ClaudeServerSideTool,
  type ConversationMessage,
} from '../intelligence/claude';
import { callGemini, toGeminiContents } from '../intelligence/gemini';
import { resolveProviderKey, type BYOKProvider } from '../security/byok';
import { enforceTwinInvariant, TwinViolationError } from '../twin/guard';
import {
  toolSchemas,
  type ToolContext,
  type ToolDefinition,
  type ToolExecutionResult,
} from '../intelligence/tools';

export type ProviderName = 'claude' | 'gemini' | 'ollama';

export interface DispatchPlan {
  skillName: string;
  requestedModel: SkillModel;
  effectiveModel: SkillModel;
  provider: ProviderName;
  concreteModel: string;
  costTier?: SkillCostTier;
  requiresTwin: boolean;
  downgraded: boolean;
  overridden: boolean;
}

export interface DispatchImage {
  mediaType: string;
  base64Data: string;
}

export interface DispatchInput {
  skill: string;
  templateVars?: Record<string, string>;
  userMessage?: string;
  history?: ConversationMessage[];
  images?: DispatchImage[];
  context?: string[];

  familyId?: string;
  profileId?: string;
  apiKey?: string;
  keyIdentifier?: string;
  /**
   * If true and `profileId` is set, the router will attempt to use the user's
   * BYOK key for the resolved provider. The deployment-level key is used as
   * fallback when no BYOK key is configured or enabled. Default: false (family
   * default key). Set true only when the call is on behalf of a single user
   * (e.g. interactive_query, autolearn).
   */
  useBYOK?: boolean;

  maxTokens?: number;
  temperature?: number;

  dryRun?: boolean;

  /**
   * Optional tool registry. When provided (and the resolved provider is
   * Claude), the router runs a tool-use loop: Claude may emit tool_use
   * blocks, each is executed via its definition's `execute()`, and the
   * resulting tool_result blocks are fed back to Claude. Loop terminates
   * on stop_reason !== 'tool_use' or on MAX_TOOL_ITERATIONS.
   *
   * Non-Claude providers (Gemini, local) ignore `tools` for now — they
   * have different function-calling shapes and are deferred.
   */
  tools?: Record<string, ToolDefinition>;
  toolContext?: ToolContext;

  /**
   * Optional Anthropic server-side tools (e.g. web_search_20250305).
   * Sent alongside local tools in the same `tools` array on the API call.
   * Claude may invoke them mid-turn; Anthropic resolves them server-side
   * and returns the result inline as `web_search_tool_result` blocks. The
   * router does NOT execute these locally — it only synthesises a
   * ToolCallLogEntry per `server_tool_use` block for telemetry / footer.
   */
  serverTools?: ClaudeServerSideTool[];
}

export interface ToolCallLogEntry {
  name: string;
  ok: boolean;
  error?: string;
  output?: Record<string, unknown>;
}

export interface DispatchResult {
  text: string;
  plan: DispatchPlan;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  ledgerId?: string;
  dummy: boolean;
  dryRun: boolean;
  toolCalls?: ToolCallLogEntry[];
}

const MAX_TOOL_ITERATIONS = 5;

// ----------------------------------------------------------------------------
// Model alias → provider+concrete resolution
// ----------------------------------------------------------------------------

interface Resolution {
  provider: ProviderName;
  concreteModel: string;
}

const CLAUDE_HAIKU = process.env.MEMU_CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001';
const CLAUDE_SONNET = process.env.MEMU_CLAUDE_SONNET_MODEL || 'claude-sonnet-4-6';
const GEMINI_FLASH = process.env.MEMU_GEMINI_FLASH_MODEL || 'gemini-2.5-flash';
const GEMINI_FLASH_LITE = process.env.MEMU_GEMINI_FLASH_LITE_MODEL || 'gemini-2.5-flash-lite';
const OLLAMA_DEFAULT = process.env.MEMU_OLLAMA_MODEL || 'llama3.2';

function resolveAlias(alias: SkillModel): Resolution {
  switch (alias) {
    case 'haiku':
      return { provider: 'claude', concreteModel: CLAUDE_HAIKU };
    case 'sonnet':
      return { provider: 'claude', concreteModel: CLAUDE_SONNET };
    case 'sonnet-vision':
      // Sonnet 4.6 natively supports vision.
      return { provider: 'claude', concreteModel: CLAUDE_SONNET };
    case 'gemini-flash':
      return { provider: 'gemini', concreteModel: GEMINI_FLASH };
    case 'gemini-flash-lite':
      return { provider: 'gemini', concreteModel: GEMINI_FLASH_LITE };
    case 'local':
      return { provider: 'ollama', concreteModel: OLLAMA_DEFAULT };
    case 'auto':
      // Auto currently favours Claude Haiku for cheap, Sonnet for anything else.
      // Story 1.1 scope: simple default; smarter auto picks come later.
      return { provider: 'claude', concreteModel: CLAUDE_HAIKU };
  }
}

// ----------------------------------------------------------------------------
// Env override and cost-tier downgrade
// ----------------------------------------------------------------------------

const VALID_ALIASES: SkillModel[] = [
  'haiku',
  'sonnet',
  'sonnet-vision',
  'gemini-flash',
  'gemini-flash-lite',
  'local',
  'auto',
];

function applyEnvOverride(alias: SkillModel): { alias: SkillModel; overridden: boolean } {
  const key = `MEMU_MODEL_OVERRIDE_${alias.toUpperCase().replace(/-/g, '_')}`;
  const raw = process.env[key];
  if (!raw) return { alias, overridden: false };
  const normalised = raw.toLowerCase() as SkillModel;
  if (!VALID_ALIASES.includes(normalised)) {
    console.warn(`[ROUTER] Ignoring invalid ${key}=${raw}`);
    return { alias, overridden: false };
  }
  return { alias: normalised, overridden: true };
}

function applyBudgetDowngrade(alias: SkillModel, costTier?: SkillCostTier): { alias: SkillModel; downgraded: boolean } {
  if (process.env.MEMU_BUDGET_PRESSURE !== 'true') return { alias, downgraded: false };
  if (!costTier) return { alias, downgraded: false };

  // Premium → standard, standard → cheap.
  if (costTier === 'premium') {
    if (alias === 'sonnet-vision' || alias === 'sonnet') {
      return { alias: 'haiku', downgraded: true };
    }
  }
  if (costTier === 'standard') {
    if (alias === 'sonnet') return { alias: 'haiku', downgraded: true };
    if (alias === 'gemini-flash') return { alias: 'gemini-flash-lite', downgraded: true };
  }
  return { alias, downgraded: false };
}

// ----------------------------------------------------------------------------
// Planning
// ----------------------------------------------------------------------------

export function planDispatch(skillName: string): DispatchPlan {
  const skill: Skill = getSkill(skillName);
  const requested = skill.frontmatter.model;
  const costTier = skill.frontmatter.cost_tier;

  const { alias: afterOverride, overridden } = applyEnvOverride(requested);
  const { alias: effective, downgraded } = applyBudgetDowngrade(afterOverride, costTier);
  const { provider, concreteModel } = resolveAlias(effective);

  return {
    skillName,
    requestedModel: requested,
    effectiveModel: effective,
    provider,
    concreteModel,
    costTier,
    requiresTwin: skill.frontmatter.requires_twin === true,
    downgraded,
    overridden,
  };
}

// ----------------------------------------------------------------------------
// Ledger write
// ----------------------------------------------------------------------------

async function writeLedger(
  plan: DispatchPlan,
  input: DispatchInput,
  keyIdentifier: string,
  outcome: {
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    status: 'ok' | 'error' | 'dry_run' | 'dummy';
    errorMessage?: string;
    twinVerified?: boolean;
    twinViolations?: string[];
  },
): Promise<string | undefined> {
  try {
    const res = await pool.query(
      `INSERT INTO privacy_ledger (
        family_id, profile_id, skill_name, requested_model, dispatched_model, provider,
        cost_tier, requires_twin, twin_verified, key_identifier,
        tokens_in, tokens_out, latency_ms, status, error_message, dry_run,
        twin_violations
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id`,
      [
        input.familyId ?? null,
        input.profileId ?? null,
        plan.skillName,
        plan.requestedModel,
        plan.concreteModel,
        plan.provider,
        plan.costTier ?? null,
        plan.requiresTwin,
        outcome.twinVerified ?? false,
        keyIdentifier,
        outcome.tokensIn,
        outcome.tokensOut,
        outcome.latencyMs,
        outcome.status,
        outcome.errorMessage ?? null,
        input.dryRun === true,
        outcome.twinViolations && outcome.twinViolations.length > 0
          ? JSON.stringify(outcome.twinViolations)
          : null,
      ],
    );
    return res.rows[0]?.id as string | undefined;
  } catch (err) {
    console.error('[ROUTER] Privacy ledger write failed:', err);
    return undefined;
  }
}

// ----------------------------------------------------------------------------
// Dispatch
// ----------------------------------------------------------------------------

/**
 * Scan a Claude response's content array for server-side tool invocations
 * (e.g. web_search) and append a synthesised `ToolCallLogEntry` for each.
 *
 * Server-side tools come back as a pair of blocks:
 *   { type: 'server_tool_use', id, name, input } — Claude invoked the tool
 *   { type: 'web_search_tool_result', tool_use_id, content } — the result
 *
 * We pair them by tool_use_id and decide ok/fail from the result's content
 * shape: an array of result items → ok; an object with type
 * 'web_search_tool_result_error' → fail. Anthropic resolved the call —
 * Memu's only job is to surface what happened in the footer.
 *
 * Naming: we use `webSearch` (camelCase) for the synthesised entry's
 * `name` field so `formatToolSummaryFooter`'s existing case branch
 * matches without a renaming pass. The wire-level Anthropic name is
 * `web_search` (snake_case); we translate at this boundary.
 */
export function collectServerToolCalls(
  content: ClaudeContentBlock[],
  toolCalls: ToolCallLogEntry[],
): void {
  // Build a map of tool_use_id → result for pairing.
  const resultsByToolUseId = new Map<string, unknown>();
  for (const block of content) {
    if (block.type === 'web_search_tool_result') {
      resultsByToolUseId.set(block.tool_use_id, block.content);
    }
  }

  for (const block of content) {
    if (block.type !== 'server_tool_use') continue;
    if (block.name !== 'web_search') continue;

    const result = resultsByToolUseId.get(block.id);
    let ok = true;
    let error: string | undefined;
    let output: Record<string, unknown> | undefined;

    if (result === undefined) {
      // Server tool was invoked but no result block came back. Treat as
      // pending / unknown — surface as a soft failure so the user sees
      // something rather than nothing.
      ok = false;
      error = 'no_result_returned';
    } else if (
      typeof result === 'object' &&
      result !== null &&
      (result as { type?: unknown }).type === 'web_search_tool_result_error'
    ) {
      ok = false;
      const r = result as { error_code?: unknown };
      error = typeof r.error_code === 'string' ? r.error_code : 'web_search_error';
    } else {
      // Array of result items (or other ok shape). We don't echo the
      // actual results into output — they're public web content but
      // surfacing them in toolCalls would feed real names back to
      // future-turn analysis. Just mark ok with the count.
      const count = Array.isArray(result) ? result.length : 0;
      output = { count };
      if (count === 0) {
        // Search ran but returned zero matches. Surface as a failure for
        // user clarity — the footer's "searched the web" wording would
        // mislead if nothing came back.
        ok = false;
        error = 'no_results';
      }
    }

    toolCalls.push({
      name: 'webSearch',
      ok,
      error,
      output,
    });
  }
}

function buildClaudeMessages(input: DispatchInput, userPrompt: string): ClaudeCallInput['messages'] {
  const history = input.history ?? [];
  if (input.images && input.images.length > 0) {
    const contentBlocks: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    > = input.images.map(img => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64Data },
    }));
    contentBlocks.push({ type: 'text' as const, text: userPrompt });
    return [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: contentBlocks },
    ];
  }
  return [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userPrompt },
  ];
}

function resolveUserPrompt(skill: Skill, input: DispatchInput): { systemPrompt?: string; userPrompt: string } {
  const body = input.templateVars
    ? renderTemplate(skill.body, input.templateVars)
    : skill.body;

  // Skills are authored as either a system prompt or a user-prompt template.
  // For the router we treat skill.body as the system prompt by default, and the
  // caller's userMessage as the user prompt. For skills explicitly authored as
  // a user-prompt template (no userMessage provided), we send body as the user
  // prompt instead. This matches how extraction/vision/autolearn/interactive_query
  // use skills as system prompts, while synthesis/briefing/import_extract
  // render the full user prompt.
  if (input.userMessage !== undefined) {
    return { systemPrompt: body, userPrompt: input.userMessage };
  }
  return { userPrompt: body };
}

function providerToBYOKProvider(provider: ProviderName): BYOKProvider | null {
  if (provider === 'claude') return 'anthropic';
  if (provider === 'gemini') return 'gemini';
  return null;
}

async function resolveCallKey(
  input: DispatchInput,
  provider: ProviderName,
): Promise<{ apiKey?: string; keyIdentifier: string }> {
  if (input.apiKey) {
    return { apiKey: input.apiKey, keyIdentifier: input.keyIdentifier ?? 'explicit' };
  }
  if (input.useBYOK && input.profileId) {
    const byokProvider = providerToBYOKProvider(provider);
    if (byokProvider) {
      const resolved = await resolveProviderKey(input.profileId, byokProvider);
      if (resolved) return resolved;
    }
  }
  return { keyIdentifier: 'family_default' };
}

export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const plan = planDispatch(input.skill);
  const skill = getSkill(input.skill);
  const { systemPrompt, userPrompt } = resolveUserPrompt(skill, input);
  const callKey = await resolveCallKey(input, plan.provider);

  if (input.dryRun) {
    const ledgerId = await writeLedger(plan, input, callKey.keyIdentifier, {
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      status: 'dry_run',
    });
    return {
      text: '',
      plan,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      ledgerId,
      dummy: false,
      dryRun: true,
    };
  }

  // Twin invariant — only for skills that declare requires_twin: true.
  // This runs *after* callers have already (by convention) anonymised, and acts
  // as the belt-and-braces guard that catches developer mistakes before the
  // network request goes out. See src/twin/guard.ts.
  let effectiveSystemPrompt = systemPrompt;
  let effectiveUserPrompt = userPrompt;
  let effectiveHistory = input.history;
  let twinVerified = false;
  let twinViolations: string[] = [];

  if (plan.requiresTwin) {
    try {
      const enforcement = await enforceTwinInvariant(input.skill, {
        systemPrompt,
        userPrompt,
        history: input.history,
      });
      twinVerified = enforcement.verified;
      twinViolations = enforcement.violations;
      effectiveSystemPrompt = enforcement.fields.systemPrompt;
      effectiveUserPrompt = enforcement.fields.userPrompt;
      if (enforcement.fields.history) {
        effectiveHistory = enforcement.fields.history.map(h => ({
          role: h.role as ConversationMessage['role'],
          content: h.content,
        }));
      }
      if (twinViolations.length > 0) {
        console.warn(
          `[TWIN-GUARD] Auto-anonymised ${twinViolations.length} leaking entit${twinViolations.length === 1 ? 'y' : 'ies'} in skill "${input.skill}" before dispatch.`,
        );
      }
    } catch (err) {
      if (err instanceof TwinViolationError) {
        await writeLedger(plan, input, callKey.keyIdentifier, {
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: 0,
          status: 'error',
          errorMessage: err.message,
          twinVerified: false,
          twinViolations: err.violations,
        });
      }
      throw err;
    }
  }

  try {
    if (plan.provider === 'claude') {
      const messages = buildClaudeMessages(
        { ...input, history: effectiveHistory },
        effectiveUserPrompt,
      );
      const tools = input.tools;
      const serverTools = input.serverTools ?? [];
      const hasLocalTools = !!(tools && Object.keys(tools).length > 0 && input.toolContext);
      const localSchemas = hasLocalTools ? toolSchemas(tools!) : [];
      const combinedTools =
        localSchemas.length > 0 || serverTools.length > 0
          ? [...localSchemas, ...serverTools]
          : undefined;

      let totalIn = 0;
      let totalOut = 0;
      let totalLatency = 0;
      let finalText = '';
      let dummy = false;
      const toolCalls: ToolCallLogEntry[] = [];

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const result = await callClaude({
          model: plan.concreteModel,
          system: effectiveSystemPrompt,
          messages,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
          apiKey: callKey.apiKey,
          tools: combinedTools,
        });
        totalIn += result.tokensIn;
        totalOut += result.tokensOut;
        totalLatency += result.latencyMs;
        dummy = dummy || result.dummy;
        finalText = result.text;

        // Scan server-side tool invocations for telemetry. Anthropic
        // resolves these server-side; we only synthesise a
        // ToolCallLogEntry so the orchestrator's footer can surface
        // "searched the web". Done every iteration — server-side calls
        // can fire on any iteration, not just the last.
        collectServerToolCalls(result.content, toolCalls);

        if (!hasLocalTools || result.stopReason !== 'tool_use' || result.dummy) {
          break;
        }

        const toolUses = result.content.filter(
          (b): b is Extract<ClaudeContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
        );
        if (toolUses.length === 0) break;

        messages.push({ role: 'assistant', content: result.content });

        const toolResults: ClaudeContentBlock[] = [];
        for (const call of toolUses) {
          const def = tools![call.name];
          let execResult: ToolExecutionResult;
          if (!def) {
            execResult = { ok: false, error: `Unknown tool: ${call.name}` };
          } else {
            try {
              execResult = await def.execute(call.input, input.toolContext!);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              execResult = { ok: false, error: `Tool threw: ${message}` };
            }
          }
          toolCalls.push({
            name: call.name,
            ok: execResult.ok,
            error: execResult.error,
            output: execResult.output,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify({
              ok: execResult.ok,
              ...(execResult.output ? { ...execResult.output } : {}),
              ...(execResult.error ? { error: execResult.error } : {}),
            }),
            is_error: !execResult.ok,
          });
        }
        messages.push({ role: 'user', content: toolResults });
      }

      const ledgerId = await writeLedger(plan, input, callKey.keyIdentifier, {
        tokensIn: totalIn,
        tokensOut: totalOut,
        latencyMs: totalLatency,
        status: dummy ? 'dummy' : 'ok',
        twinVerified,
        twinViolations,
      });
      return {
        text: finalText,
        plan,
        tokensIn: totalIn,
        tokensOut: totalOut,
        latencyMs: totalLatency,
        ledgerId,
        dummy,
        dryRun: false,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }

    if (plan.provider === 'gemini') {
      const contents = toGeminiContents(effectiveUserPrompt, effectiveHistory);
      const result = await callGemini({
        model: plan.concreteModel,
        systemInstruction: effectiveSystemPrompt,
        contents,
        apiKey: callKey.apiKey,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
      const ledgerId = await writeLedger(plan, input, callKey.keyIdentifier, {
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs,
        status: result.dummy ? 'dummy' : 'ok',
        twinVerified,
        twinViolations,
      });
      return {
        text: result.text,
        plan,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs,
        ledgerId,
        dummy: result.dummy,
        dryRun: false,
      };
    }

    // Ollama / local — not wired yet. Story 1.5 / Tier 3 work.
    throw new Error(
      `Local/Ollama dispatch is not yet implemented. Skill "${input.skill}" requested model "${plan.requestedModel}" which resolves to provider "${plan.provider}". ` +
        `Set MEMU_MODEL_OVERRIDE_${plan.requestedModel.toUpperCase()} to a cloud alias as a temporary override.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeLedger(plan, input, callKey.keyIdentifier, {
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      status: 'error',
      errorMessage: message,
      twinVerified,
      twinViolations,
    });
    throw err;
  }
}
