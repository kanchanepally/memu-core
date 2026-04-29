# Conviction & Specialist Cluster — Experience Audit

**Cluster framing.** This cluster spans Memu's highest-trust potential users and its most implausible ones. The privacy maximalist and the journalist are not just likely adopters — they are the users whose endorsement confers credibility with every other segment. The neighbour is a fiction; what Memu calls "cross-household sharing" is plumbing without a surface. The multi-agent power user is a partial fit dependent on protocol commitments that are roughly half-delivered. Honesty about this spread is more useful than averaging it into a moderate score.

---

## Persona 1: Self-hoster / Privacy Maximalist

### Snapshot
Andreas is 38, a backend developer living in Berlin. He runs a Nextcloud instance on a refurbished ThinkCentre, uses Bitwarden self-hosted, routes his family's DNS through Pi-hole, and cancelled his Google account three years ago. He reads r/selfhosted compulsively. He has strong opinions about AGPLv3 versus GPL. He will clone the repo before he reads the README. He has rebuilt his family's photo library in Immich twice. He is broadly sympathetic to Memu's premise but constitutionally allergic to claims that aren't backed by code.

### Jobs to be done
- Replace his hacked-together family coordination layer (a mix of shared Nextcloud notes and a Telegram family group) with something that has a defined data model and privacy story
- Confirm that no family data leaves the household without his explicit authorisation
- Understand exactly what an AI call looks like — which model, what tokens, what's visible
- Know what happens when Anthropic's (or Gemini's, or DeepSeek's) API is down
- Have a migration path out of Memu if he changes his mind — export everything, no lock-in

### Where Memu fits
This is Memu's best-fit persona for the Tier-2 self-hosted deployment. The architecture is honest: AGPLv3, Docker Compose, local embeddings (Xenova, zero external calls), a Digital Twin that anonymises entity names before any cloud API call, and a Privacy Ledger that records every dispatch — model, provider, token counts, what the Twin translated. The `guard.ts` enforcement is real and verifiable. The Article-20-style export endpoint is real. The OIDC provider is a proper Panva oidc-provider v8 instance, not a homegrown JWT stamper. For a user who will read the code, there is actual code to read and it largely does what it claims. The gaps are specific and discoverable, which is the right failure mode for this persona.

### Day 0 — first 5 minutes
**What onboarding should reveal:** Docker Compose pulls five containers, starts cleanly, health check passes, and the first web page is the setup wizard rather than a blank port. The wizard should ask for: admin email, family display names, and — critically — BYOK configuration (Anthropic or Gemini API key). Within those five minutes, this persona wants to see the Privacy Ledger exist and be empty, and then see one test message appear in it.

**What it should ask for:** BYOK key, family composition (names, roles), whether to enable WhatsApp (optional, and the UI should be clear it uses an unofficial library). It should NOT ask for any cloud account, should NOT phone home, and should surface the Tailscale/no-Tailscale decision explicitly because that is a meaningful network-topology choice.

**The promise it should land:** "Your family's AI assistant runs on your hardware. Every AI call goes through a name-anonymiser before it leaves. You can see every call in the Privacy Ledger. The data stays here."

### Day 1 — first 24 hours
Andreas will immediately read the source. He will find `twin/translator.ts`, verify it is a word-boundary regex replacement against `entity_registry`, notice that the fallback entities (`Alice`, `Bob`, `Springfield Elementary`) are hardcoded in the source and will log if the DB is empty during initial setup — a minor but visible trust signal that the code has a scaffolding-era assumption still in it. He will find `twin/guard.ts` and read the `resolveGuardMode()` function: production defaults to `log_and_anonymize`, not `throw`. That means a Twin violation in production is silently remediated rather than surface-visible. He will want to know he can set `MEMU_TWIN_GUARD_MODE=throw` in production on his own instance, and that this is documented.

He will notice that the OIDC provider supports DPoP and that `verifyDpopProof` is implemented in `bearer.ts` — but then find the comment in the same file: "DPoP proof verification of method+url+body (3.3b/c follow-up). Read-only access tolerates a plain bearer for early adopters." He will correctly identify that DPoP is plumbed as an option but not enforced on the server side — a token with `cnf.jkt` triggers DPoP verification on the Solid routes, but a plain bearer token with no `cnf.jkt` is accepted without DPoP regardless of how the OIDC provider issued it. For a privacy maximalist, "DPoP supported when the token requests it" and "DPoP enforced for all access" are different propositions and Memu only satisfies the first.

He will also notice that the DeepSeek provider (added 2026-04-26) is a Chinese company whose data jurisdiction is China, and that the routing memory notes "same shape as Anthropic (US)" — meaning the Twin invariant applies, but the jurisdiction fact is worth surfacing in the UI for self-hosters who have explicitly chosen European or self-sovereign routing.

### Day 7 — end of first week
**What should have accumulated:** The Privacy Ledger should show a week of family interactions, provider dispatches, token counts, and Twin translation records. The `entity_translations` JSONB column should be populated and readable via the export endpoint.

**The "ah, this is useful" moment:** The Privacy Ledger is genuinely differentiating. No other family AI tool shows you, per interaction, which model received what anonymised text. For a privacy maximalist this is not a nice-to-have — it is the reason to trust the system at all. If the Ledger is surfaced well in the PWA (currently it is a dedicated screen in the mobile app; its PWA equivalent is less prominent), this persona will become an advocate.

### Day 30 — would they renew Founding-50?
Yes, conditional. If the setup worked cleanly and the Ledger has been building up, this persona will renew at £2.99/month because the alternative is maintaining their own equivalent from scratch. The condition is that they did not encounter the git ENOENT bug (the `spaces/store.ts` `ensureFamilyRepo` calls `git init` without wrapping, and the container is missing the git binary on PATH — this is a documented open bug that blocks clean Z2 installs). If they hit that on day one, they will not return.

### Empty-state behaviour
This is a critical failure point. On first boot with no family data, Memu's AI will be asked questions about a family it knows nothing about. The fallback entities in `translator.ts` (`Alice`, `Bob`, `Springfield Elementary`) will be used if `entity_registry` is empty. The correct behaviour is to surface explicitly that the system has no knowledge yet and offer the import path (WhatsApp chat export, or manual Space creation) rather than producing confident-sounding AI responses from empty context. A privacy maximalist who asks "what do you know about our family?" and gets a confident answer synthesised from nothing will not forgive it.

### Where Memu currently fails them

1. **The git ENOENT bug is latent on every clean install.** `spaces/store.ts` calls `git init` unguarded; the Docker image does not have git on PATH. Severity: blocking for any new family setup. Documented but unresolved.

2. **Twin guard defaults to `log_and_anonymize` in production, not `throw`.** This is a deliberate operational tradeoff but it means that a violation in production is silently fixed rather than surfaced to the user. The Privacy Ledger records it, but there is no user-visible alert. A user who believes their family names never reach an external API will not know when the fallback fired unless they audit the ledger regularly.

3. **DPoP is implemented but not enforced server-side as a requirement.** `bearer.ts` comment is explicit: "Read-only access tolerates a plain bearer for early adopters." A client that obtains a DPoP-bound token gets DPoP verification; a client that obtains a plain bearer token gets plain bearer verification. The protection depends on what the client requested, not on what the server mandates.

4. **`jti` replay detection is unimplemented.** `verifyDpopProof` notes: "We do NOT yet maintain a jti replay cache." The `iat` window is the only replay brake. This is documented internally but not visible to users who read the DPoP support claim.

5. **The solid_client.ts external fetch path does not pass through the Twin.** When Memu fetches a Space from an external Pod via `fetchExternalSpaceConditional`, the body comes in raw. It is parsed and stored in `external_space_cache`. There is no Twin translation of that body before it reaches the retrieval layer. If an external Space contains real names (from a different household's Memu), those names could appear in retrieval context passed to the LLM. The `external_sync.ts` registers foreign WebIDs into `entity_registry`, but that registration is for the fetched Space's `people[]` field — it does not translate the `bodyMarkdown` of the fetched Space. Severity: moderate for self-hosted Tier-2, not yet a live issue because Story 3.4 (cross-household) is in code but has no mobile UI surface (3.4c not shipped).

6. **The DeepSeek provider jurisdiction is not surfaced in the UI.** A self-hoster who configured Anthropic (US) as their BYOK provider may not know that budget-pressure cascade falls through to DeepSeek (China) without explicit opt-in. Currently the cascade is `deepseek-reasoner → deepseek-chat → gemini-flash-lite` and no skill SKILL.md has been migrated, so no live traffic goes to DeepSeek yet — but the provider is wired and the cascade logic exists.

7. **Log volume from `console.log` in orchestrator.ts is high.** Step-by-step translation output (`[IN -> Translated]:`, `[LLM -> Raw]:`) goes to stdout. On a shared home server this leaks anonymised-but-not-fully-opaque content to anyone with `docker logs` access.

### Highest-value first build for this persona
Fix the git ENOENT bug in the Docker image, surface the Twin violation alert in the Privacy Ledger UI (not just a silent log entry), and add one sentence of documentation to the `MEMU_TWIN_GUARD_MODE` env var explaining the production default. Together these close the gap between "claims to be privacy-first" and "actually demonstrates it to someone who will check."

---

## Persona 2: Researcher / Journalist (Sensitive Sources)

### Snapshot
Yusuf is a freelance investigative journalist covering financial crime. He has sources at three major banks and one HMRC contact who sends documents via Signal, cleans metadata, and never uses real names in messages. He uses a Proton account for email. He has considered Tails. He is not a developer but he can follow a Docker Compose tutorial. His threat model is not "big tech annoying data broker" — it is "the subject of my investigation has a legal team." He does not need parental controls. He needs a place where "the redacted contract draft from a whistleblower at HSBC, sent via Signal, that I pasted into my notes" is stored and retrievable without that text having been sent to an American technology company in a form that could be subpoenaed.

### Jobs to be done
- Store sensitive source notes and document fragments in a system that does not transmit their content to cloud services outside his control
- Be able to ask questions against accumulated notes ("what did the third HSBC contact say about the clearing house?") without those notes leaving his hardware
- Maintain a credible record of what the AI was told and when — for source protection and for legal defensibility
- Know who else has access to his instance — and have zero shared access by default
- Export everything in a portable format if he needs to hand records to a lawyer or delete them on short notice

### Where Memu fits
The fit is partial and conditional on deployment mode. In Tier-2 self-hosted mode, Memu offers something genuinely useful that most journalists do not have: a structured, searchable note store with an audit trail. The Digital Twin means that if Yusuf has registered his sources as entities (e.g., "Margaret Fisher" → "Contact-3"), messages to the AI about them go out anonymised. The Privacy Ledger gives him a verifiable record of every AI dispatch. The Article-20 export exists. The OIDC provider means if he sets up multiple profiles, each has a WebID-backed identity. However, Memu is not a threat-model-grade tool in its current state and claiming it is would be dishonest. It is useful for the "low-stakes version of the same problem" — a journalist who wants to be more organised, not one who is actively being surveilled.

### Day 0 — first 5 minutes
**What onboarding should reveal:** Whether the AI call goes outside the hardware. The setup wizard needs to make this explicit and verifiable — not aspirationally but operationally. The BYOK prompt is the right place: "Your API key is used to call [Anthropic / Gemini / DeepSeek]. All calls are anonymised through the Digital Twin, but they do leave your network. If this is unacceptable, use the local AI option when docked to memu-os." Currently, whether local AI (Ollama) is available depends on whether Memu Core is docked into memu-os — and that configuration is not surfaced at all during setup.

**What it should ask for:** BYOK key and provider choice, with explicit provider jurisdiction displayed. It should offer the option to disable cloud AI entirely (and tell the user what that means for capability). It should surface whether WhatsApp is enabled by default and explain that the Baileys connector uses an unofficial API.

**The promise it should land:** "Notes you add here go through a name-anonymiser before any AI call. The Privacy Ledger records every call. You can export everything."

### Day 1 — first 24 hours
Yusuf pastes a fragment of a source document into the chat: "Remember this — the clearing house transaction on 14 March was flagged by two risk officers, code-named Bravo and Delta in my notes." He expects the system to store it and be retrievable. What actually happens: the `autolearn` skill runs, extracts an observation, routes it to a matching Space if confidence ≥ 0.7. The Twin will try to translate "Bravo" and "Delta" — but only if those labels are already in `entity_registry`. If they are not, the names pass through as-is. Novel entity detection (`twin/novel.ts`) runs before the Twin translation step and attempts to register unseen proper nouns — but whether "Bravo" and "Delta" trigger that detection depends on the NER model's classification; code-names not in a training corpus will likely miss. For a journalist relying on pseudonymous codes, the Twin's entity-registry-based approach is the wrong abstraction — it assumes you register names in advance, not that you use ad-hoc codes.

The second problem Yusuf will hit: DeepSeek is wired as a routing provider. He did not choose it. Even if no skills have been migrated to DeepSeek yet (as of 2026-04-26), the cascade logic exists and a future skill migration could route his data to a Chinese company's API without him being explicitly prompted. For a journalist with sources in certain geographies, this is not a theoretical risk.

### Day 7 — end of first week
**What should have accumulated:** A set of Spaces containing accumulated notes about the investigation. The `synthesis_update` skill should have merged related observations across conversations. The Privacy Ledger should show all dispatches.

**The "ah, this is useful" moment:** The `/recall` equivalent (asking "what do I know about the clearing house investigation?") pulling from accumulated Spaces with proper retrieval provenance is the differentiating moment. If it works — returning relevant synthesised notes with a clear "retrieved from: [Space name]" trail — this persona sees the value. Today, retrieval provenance is stored in the database and logged but not surfaced in the AI's reply text. The user does not see "this came from the HSBC-notes Space." They see the AI's synthesised answer. For a journalist, provenance is the product.

### Day 30 — would they renew Founding-50?
Possibly, with reservations. The reservations are structural, not cosmetic. A journalist who needed this capability seriously would be running Memu on air-gapped hardware with no cloud AI — which means docked to memu-os with Ollama. That configuration is not yet first-class for a single non-technical journalist. If Yusuf can tolerate the cloud AI path (anonymised but not zero-network), and if the git ENOENT bug doesn't block his setup, he would renew at £2.99/month because the alternative is Obsidian with no AI layer, which he is already frustrated with.

### Empty-state behaviour
A journalist who asks "what do I know about [investigation]?" on an empty database will get a confident AI response synthesised from general knowledge, not from their notes. This is the highest-risk empty-state failure in the entire audit. The system must not produce confident answers about named subjects from empty context. The correct response when the retrieval layer returns nothing is "I have no notes on that yet" — not a synthesis from the LLM's parametric knowledge which may contradict, invent, or conflate source information.

### Where Memu currently fails them

1. **Cloud AI by default, no air-gap mode.** Local AI (Ollama) only works in docked memu-os configuration. For a journalist on a standalone cloud or home setup, every AI call goes outside the hardware. The Twin helps, but "anonymised tokens sent to Anthropic" is not the same as "nothing left the room."

2. **The Twin is only as good as the entity registry.** If you use ad-hoc codes, numeric labels, or pseudonyms that differ from conversation to conversation ("Source A" in one chat, "the risk officer" in another), the registry-based approach will not protect you. The novel entity detector does not know that "the risk officer" and "Contact-7" refer to the same person.

3. **Retrieval provenance is not surfaced to the user.** When the AI answers "what did Bravo say about the clearing house?" the user gets the synthesis but not "this came from Space X, last updated Y." For legal defensibility, provenance visibility is not optional.

4. **DeepSeek is silently in the cascade.** No skill has migrated to DeepSeek yet, but the wiring exists and the cascade is automatic. A user who chose Anthropic as their provider does not currently consent to DeepSeek as a fallback. This needs an explicit BYOK screen that lists all possible routing targets per skill.

5. **The export is comprehensive but not time-limited.** The Article-20 export produces a ZIP of everything. A journalist who wants "only the notes from the past 30 days" or "only this specific Space's history" cannot do a scoped export. For source-protection, the ability to surgically delete or export a bounded set of records is important.

6. **No deletion story.** There is no UI or API for "delete all notes about [source]." The export endpoint is implemented; the delete-by-scope path is not. For a journalist who needs to protect a source on short notice ("destroy everything about Contact-7"), this is a gap.

7. **pino logging writes structured logs that include anonymised message content to stdout.** `docker logs` on the host shows every translated message. On a VPS, this means cloud provider log retention could capture content. No log-level guidance for sensitive deployments exists in the documentation.

### Highest-value first build for this persona
Retrieval provenance in the AI reply. When the answer comes from an existing Space, the reply should cite it ("Based on your HSBC-notes Space, last updated April 12"). This closes the "AI making things up vs AI drawing from your documented notes" gap, which is the core value proposition for this persona and currently invisible.

---

## Persona 3: Neighbour / Community-light User

### Snapshot
Priya lives two streets from a family that uses Memu. She coordinates the Wednesday tea-and-check-in rota at a local mosque, shared with three neighbours and a volunteer coordinator. She might be invited to a shared Memu Space — a community meal planner, a neighbourhood watch thread, a care schedule for an elderly person. She does not want to install an app. She is not paying for anything. She may have been sent a link. She may not understand what Memu is.

### Jobs to be done
- See the content of the shared Space she was invited to (the rota, the meal plan, the meeting notes)
- Add something to it — her availability for Wednesday, her potluck dish, her update on the neighbour
- Receive a notification when someone changes the plan
- Not have to create an account, download an app, or understand what a Pod is

### Where Memu fits
This is the weakest product-market fit in the cluster. The honest summary: Memu has backend plumbing that could serve this use case (the `household_members` table, `pod_grants`, the `households/membership.ts` service layer, the Solid read surface), and it has a magic-link onboarding flow that generates a `?serverUrl=&apiKey=` URL. What it does not have is a read-only, anonymous, link-accessible view of a single Space that a non-member can open in a browser without an API key. The existing magic-link flow creates a profile with an API key — it adds the person as a household member, not as an external reader of one document. That is the wrong abstraction for Priya. She does not want to join the household. She wants to read a page.

The Story 3.4 cross-household sharing work (membership.ts, pod_grants, external_sync.ts) is structural backend work for a very different scenario: another Memu user from another household wanting to connect their Pod to this household's instance. That is not Priya. Priya is a person without a Memu instance at all.

### Day 0 — first 5 minutes
Priya receives a link: "Here's the Wednesday rota — https://family.memu.digital/spaces/routine/wednesday-rota". She opens it. She gets a 401: "Authentication required." She does not know what that means. She closes the tab. **This is the entire Day 0 story for this persona today.** The Solid read surface requires a valid bearer token from this server's own OIDC provider. There is no public-read mode, no link-sharing with a pre-signed token, and no guest view.

**What onboarding should reveal:** Nothing. The persona never gets past the 401.

**What it should ask for:** Nothing, because there is no flow for this persona today.

**The promise it should land:** Cannot land. There is no external-reader flow.

### Day 1 — first 24 hours
Does not happen. Priya cannot access the Space.

### Day 7 — end of first week
Does not happen unless the household member who invited her sets her up as a household member with a magic-link, which means she now has an API key, a profile in the database, and access to the entire mobile app experience — massively disproportionate to "check the rota."

### Day 30 — would they renew Founding-50?
This persona never paid in the first place and never could. There is no guest or link-share tier.

### Empty-state behaviour
Irrelevant — the persona cannot reach any state.

### Where Memu currently fails them

1. **There is no public-read or pre-signed-link flow for Spaces.** This is a fundamental absence, not a missing detail. The Solid surface is `default-deny` and requires a valid OIDC bearer token. An external person without a Memu account cannot read any Space, ever, in the current code. The ACP resource is gated behind the same auth requirement.

2. **The magic-link flow creates a full household member, not a reader.** `POST /api/profiles` + magic-link generates a profile with an API key and full app access. There is no concept of a read-only guest or a Space-scoped external viewer.

3. **The household membership model (Story 3.4) is built for Pod-to-Pod federation, not for consumer link sharing.** The mental model for `HouseholdMember` is another Memu user with their own deployment. It has `memberWebid`, `pod_grants`, and leave policies. None of this applies to someone who was texted a link.

4. **No notification mechanism for external participants.** Even if Priya could read the Space, there is no way to push her a notification when someone changes the rota. Push notifications require the Expo Push service and the mobile app. Email notification is not implemented.

5. **The onboarding path for this persona does not exist and has no roadmap entry.** The Founding-50 and Milestone C work is focused on hosted Tier-1 for existing Memu families, not for external community members. This persona would require a separate design and build effort.

**Verdict: this persona has no viable path through Memu today, and building one is a substantial feature — not a configuration change.**

### Highest-value first build for this persona
A pre-signed, time-limited, read-only link for a specific Space — the kind of thing Notion or Google Docs calls "share with link, view only." This does not require Solid, OIDC, or household membership. It requires a `space_shares` table (token, space_id, expires_at, read_only) and a single unauthenticated route that looks up the token, checks expiry, and returns the Space body as markdown. That is roughly one session of work. Without it, this persona does not exist for Memu.

---

## Persona 4: Multi-Agent Power User ("Hybrid Agent")

### Snapshot
Alex is a product manager at a technology consultancy. She runs Claude Pro for thinking, Cursor for code, ChatGPT for quick research, Perplexity for fast lookup, and a custom Make.com automation that pulls Notion notes into a daily briefing. She is curious about whether Memu can slot into this fleet as the persistent family-context layer — the thing that other agents can query to answer questions like "what's in the fridge?" or "when is Robin's next school event?" She is less interested in Memu as a standalone assistant and more interested in whether its Solid-OIDC + WebID surface means her Claude Pro agent can fetch family Spaces directly.

### Jobs to be done
- Give her AI fleet read access to family Spaces without giving them full admin access to Memu
- Have Memu act as an MCP server that other agents (Claude Code, Cursor) can call
- Trust that when an external agent fetches a Space, it only sees what that agent is authorised to see
- Push data into Memu from external tools (a webhook from her Notion automation, a Zapier trigger)
- Understand the data model well enough to query it without reading the source

### Where Memu fits
Partial. The structural bones are right: Memu has a real OIDC provider, real WebID documents, real Solid read/write routes, real ACP enforcement, and a type index. An external agent that can perform an OIDC authorization flow could obtain a bearer token and read authorised Spaces via `GET /spaces/routine/shopping-list`. The data model is clean enough to query. The DPoP plumbing is there if the client wants it. This is more than most family AI tools offer.

What does not exist: an MCP server surface. There is no `mcp.json`, no MCP server registration, no tool schema that a Claude Code agent could discover. The Solid surface is a REST API, not an MCP API. An agent that speaks MCP cannot talk to Memu without a translation layer, and that layer does not exist. Additionally, write access via external agents works (PUT and DELETE are implemented in `solid_routes.ts`) but there is no fine-grained permission model between "household admin" and "read-only agent" — the current model is admin/adult/child, and an external agent that authenticates gets the same role as any adult household member if their profile was created with role `adult`.

### Day 0 — first 5 minutes
Alex reads the README, finds the OIDC discovery endpoint (`/.well-known/openid-configuration`), and issues a token request. This works — the provider endpoint is live, PKCE is supported, the interaction page exists. She then tries to fetch a Space with the token: `GET /spaces/routine/shopping-list` with `Authorization: Bearer <token>`. This works if her WebID is in the Space's allowed-readers set. The ACP resource is readable at `?ext=acp`. The type index is at `/typeIndex`. This is the best-case Day 0 for this persona and it is genuinely functional.

**What onboarding should reveal:** That the OIDC provider is live, the Solid surface is at `/spaces/:category/:slug`, and the type index describes what categories exist. There is no developer documentation for this surface. The information is in source comments and the CLAUDE.md. For an external agent integrator, that is not enough.

**What it should ask for:** An OIDC client registration (dynamic client registration is enabled) and a scope that scopes the token to read-only access for specific Spaces. Currently there is no read-only OIDC scope enforcement — a token issued to an external client has the same authority as one issued to the primary user.

**The promise it should land:** "Your agents can read family Spaces they're authorised to see via standard Solid-OIDC." This promise is approximately true today. The gap is in scope enforcement and in MCP discoverability.

### Day 1 — first 24 hours
Alex writes a short Python script that hits `/.well-known/openid-configuration`, performs OIDC auth, fetches the type index, and then iterates over Space URLs. This works. She then tries to configure Claude Pro's "use computer" feature to query Memu Spaces. Claude Pro does not speak Solid-OIDC natively. She would need to write an MCP wrapper. She does. It is not hard — maybe 100 lines — but it is completely undocumented and unsupported by Memu. She is building against undocumented internals, and any change to the Solid surface could break her wrapper without warning.

The second thing she tries: a write. She PUTs a new Space body from an external script. It works — `PUT /spaces/document/notes-from-cursor` accepts `text/markdown` with a valid bearer. She notices there is no PATCH, so she must re-PUT the entire body on every update. For a Notion automation that wants to append a bullet point, this means fetching, appending, and re-PUTting on every sync. Workable but inefficient and race-condition-prone.

### Day 7 — end of first week
**What should have accumulated:** A working but homegrown integration layer. Alex has a Python MCP wrapper that exposes three Memu tools: `get_space`, `list_spaces`, `update_space`. She has wired it to Claude Code via `mcp.json`. It mostly works.

**The "ah, this is useful" moment:** When Claude Code, working on a home-improvement project, asks Memu "what did we decide about the bathroom tiles?" and gets a relevant answer back from a Memu Space — without Alex having to copy-paste context into the conversation. This moment exists and is achievable with today's Memu. It is just not zero-setup.

### Day 30 — would they renew Founding-50?
Yes, if the integration is working. Alex is a power user who will tolerate undocumented surfaces. At £2.99/month, the hosted data persistence is worth it even with the MCP friction. The risk is that she builds her integration against the current Solid surface and a future code change breaks it — because there are no API versioning or stability commitments. Memu is pre-1.0 and the Solid surface is explicitly marked "Story 3.3a" in source comments, meaning there is at least a 3.3b and 3.3c that will change the surface.

### Empty-state behaviour
Alex's agents will query Memu when it has no relevant data. The correct behaviour for a Solid GET is a 404 (no Space at that URL) or an empty container listing. Both are implemented and correct. The risk is not the empty-state of the Solid surface — it is the empty-state of the AI response when Claude queries Memu via an agent and Memu returns nothing. If the agent prompt says "check Memu for context on X", and Memu returns 404, the agent must handle it gracefully. That is the agent author's responsibility, not Memu's.

### Where Memu currently fails them

1. **No MCP server surface exists.** This is the primary gap. Claude Code, Cursor, and any other MCP-native agent cannot discover Memu as a tool provider without a custom wrapper. There is no `mcp.json`, no tool schema endpoint, and no documentation for building the wrapper. Severity: high for this persona specifically.

2. **OIDC scope enforcement does not exist.** A token issued to an external agent has the same authority as a household adult profile. There is no `read:spaces` scope, no `write:spaces` scope, and no way to issue a token scoped to a specific Space. A read-only agent that obtains a token can write. This is a meaningful permission gap for a household that trusts agents with read access but not write.

3. **No PATCH support.** Only PUT (full replace) and DELETE are implemented. An agent that wants to append to a Space must fetch → modify → PUT. This creates race conditions when multiple agents write concurrently (unlikely but possible).

4. **No write path Twin coverage.** When an external agent PUTs content to a Space via the Solid route, that content bypasses the Digital Twin. Real names in content pushed from an external tool are stored as-is. There is no translation on the inbound Solid write path. If that Space is subsequently retrieved during an AI conversation, the raw names flow into the retrieval context and then through the Twin on the way to the LLM — so the Twin does eventually cover them, but the stored Space body contains real names. For Memu's privacy story, having raw names in the database is a state the system claims to avoid.

5. **External Solid client path does not apply the Twin to fetched content.** Already noted under Persona 1. For this persona: an agent that grants Memu read access to an external Pod (Story 3.4b) will have that external content indexed into synthesis without Twin translation of the body. If the external Pod's Spaces contain real names, those names enter the Memu corpus unanonymised.

6. **No developer documentation for the Solid surface.** The surface exists in `solid_routes.ts` with good source comments, but there is no external developer documentation — no API reference, no authentication flow tutorial, no example client. A developer integrating against this surface is reading TypeScript source comments.

7. **No API versioning or stability commitments.** The surface is explicitly mid-construction ("Story 3.3a", "Story 3.3b follow-up"). Building production integrations against it is a bet on compatibility.

### Highest-value first build for this persona
An MCP server adapter for the Solid surface — a thin layer that exposes `list_spaces`, `get_space`, and `update_space` as MCP tools with proper JSON schemas, and ships with an `mcp.json` that Claude Code / Cursor can pick up from the repo root. This does not require changing the Solid surface; it is a translation layer that costs roughly one focused session and immediately makes Memu discoverable to every MCP-native agent.

---

## Cross-cutting observations within this cluster

**The Twin's regex-registry design is the right choice for household use and the wrong design for adversarial use.** The privacy maximalist will appreciate its transparency. The journalist will correctly identify its weakness: it only anonymises entities you have already registered, and ad-hoc codes or contextual references pass through untranslated. The guard's `log_and_anonymize` production default means violations are remediated silently, not surfaced. These are coherent engineering choices for a family tool, not a failure — but they need to be stated clearly in the privacy documentation so the journalist does not assume threat-model-grade protection that was never claimed.

**The neighbour persona exposes a gap between "Solid Pod portability" and "link sharing."** The Solid work (Stories 3.3, 3.4) is infrastructure for federation between Memu instances. It is not, and does not claim to be, a consumer link-sharing feature. But the product narrative around "sharing Spaces" implies it to users who hear "share this Space with your neighbour." These are two completely different technical mechanisms and the product language should distinguish them before they set user expectations that cannot be met.

**DeepSeek jurisdiction exposure is a cross-persona risk that needs a UI surface before Milestone C.** All four personas in this cluster would object to Chinese data jurisdiction on different grounds (privacy maximalist: sovereignty; journalist: source protection; multi-agent: enterprise compliance). The cascade exists in code, no skills have migrated yet, but the path is open. Before any Founding-50 onboarding, the BYOK / provider configuration screen needs to enumerate all possible routing providers per skill and require explicit confirmation per provider.

**The git ENOENT bug is the single highest-priority fix before any external demo or beta onboarding.** It blocks clean installs. It will be the first thing a new self-hoster hits. It produces a confusing error that implies data corruption. It takes approximately 15 minutes to fix (add git to the Dockerfile, wrap `ensureFamilyRepo` defensively). It is undone now only because current usage is a single family on an existing install where the `.git` directory already exists.
