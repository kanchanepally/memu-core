/**
 * Build Spec 2 Phase R4 Story R4.1 — deterministic services tier.
 *
 * Pure-code analyses over Spaces, passages, embeddings, and the
 * knowledge graph. No LLM. Replayable. Each service produces
 * structured output that R5's agents consume — but the services
 * themselves stay simple and individually testable.
 *
 * The tier is named "deterministic" to distinguish from the two
 * other tiers in Phase R4: skills (single-shot LLM calls) and
 * agents (multi-step orchestrators). The architectural rule from
 * the spec §2.3: "an agent that could have been a skill is a
 * regression; a skill that could have been a deterministic service
 * is a regression." This module is the bottom rung of that tier
 * — anything that can be answered with pure code over existing
 * data lives here.
 *
 * Shipped today:
 *   - detectNearDuplicateSpaces(spaceId, options)
 *     Cosine similarity over Space embeddings. Used by R5.2's
 *     theme former to avoid creating near-duplicate themes.
 *   - walkConnections(startUri, options)
 *     Typed graph walk over space_connections. Used by R5.1's
 *     tension finder and R5.3's open-loop tracker.
 *
 * Deferred until the underlying data exists:
 *   - clusterPassagesByEmbedding(workspaceId, sourceSpaceId)
 *     Needs passage-level embeddings; passages today are addressable
 *     by data-pid but not embedded. Lands when R3.3's batch coding
 *     pass actually exists and surfaces the need.
 *   - computeCodingDrift(workspaceId, themeSpaceId, windowDays)
 *     Needs theme Spaces with > N coded passages over a time window.
 *     R3.3 produces the codings; this service consumes them. Lands
 *     after the first real coding-pass dogfood.
 */

export { detectNearDuplicateSpaces } from './nearDuplicates';
export type { NearDuplicate, NearDuplicateOptions } from './nearDuplicates';

export { walkConnections } from './walkConnections';
export type { WalkOptions, WalkNode, WalkEdge, WalkResult } from './walkConnections';
