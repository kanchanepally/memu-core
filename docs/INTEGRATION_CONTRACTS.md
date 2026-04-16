# Integration Contracts — memu-core ↔ memu-os

**Last updated:** 2026-04-15
**Scope:** What memu-core expects from the surrounding environment when deployed in Tier 2 (docked alongside memu-os v1.1 on the HP Z2). What it provides. What breaks on each side if the contract is violated.

This document is the source of truth for cross-repo integration. Pulling updates to either memu-core or memu-os without re-reading this file risks silently breaking a contract that only surfaces later — usually in a backup, a restore, or a family member's morning briefing. Read before merging either side.

---

## 1. PostgreSQL contract

**memu-core expects:**

- Host `memu_postgres` is reachable on the shared Docker network.
- A database named `memu_core` exists, owned by user `memu_user`.
- The password is passed in via `DB_PASSWORD` (read from `.env`).
- The `pgvector` extension is installed on that database.
- The database is **separate** from memu-os's databases (Synapse, Immich, Baikal each have their own).

**memu-os provides:**

- The Postgres container (`memu_postgres`), shared across the stack.
- A stable hostname on the `memu-suite_memu_net` network.
- Daily `pg_dumpall` backups at 02:00 to `/mnt/memu-data/backups/`.

**Who creates the `memu_core` database:**

- First-time deployment runs `CREATE DATABASE memu_core OWNER memu_user;` against the shared Postgres instance as a pre-deploy step (not automated yet — documented in the Phase 5 deployment checklist).
- Migrations inside the database are applied by memu-core at boot via `src/db/migrate.ts` (tracked in `schema_migrations`). Memu-core owns its schema end-to-end.

**Expected schema:**

- Tables defined in `schema.sql` (initial) plus ordered migrations in `migrations/` (currently 001–006).
- `schema_migrations` tracks which migrations have been applied.
- Memu-core **never** writes to or reads from memu-os databases. Not Synapse, not Immich, not Baikal. All cross-service data flows go through documented APIs (below).

**If the contract breaks:**

| Break | Symptom | Blast radius |
|---|---|---|
| memu-os renames the Postgres container or changes network | memu-core fails to start at boot | memu-core only; memu-os unaffected |
| Shared Postgres dropped/rebuilt without restoring `memu_core` database | memu-core boots but all queries fail; family's Memu history lost unless backups restored | memu-core data loss; memu-os unaffected if its databases are preserved |
| Memu-core accidentally writes to a memu-os database | Silent data corruption in Synapse/Immich/Baikal | Catastrophic — could corrupt family photos or chat history. This is why memu-core **must** only connect with its own `memu_core` database in the DATABASE_URL. |
| `pgvector` extension missing | Embedding writes/reads fail; context recall degrades silently to empty | memu-core only |

---

## 2. Docker network contract

**memu-core expects:**

- An external Docker network named `memu-suite_memu_net` already exists (created by memu-os).
- memu-core's `gateway` container joins this network and reaches other services by container name (`memu_postgres`, `memu_brain`, `memu_photos`, `memu_calendar`).

**memu-os provides:**

- The `memu-suite_memu_net` network, created on first `docker compose up` of the memu-os stack.
- Stable container names for `memu_postgres`, `memu_brain` (Ollama), `memu_photos` (Immich), `memu_calendar` (Baikal), `memu_synapse` (future Tier 3 wiring).

**If the contract breaks:**

| Break | Symptom |
|---|---|
| memu-os renames the network | `docker compose -f docker-compose.home.yml up` fails with "network not found" before memu-core starts |
| memu-os renames a container | memu-core starts but requests to that service fail at runtime (calendar sync drops, local Ollama calls fail, etc.) |
| memu-core tries to create its own bridge network | Breaks hostname resolution to memu-os containers; calendar/photo integrations silently degrade |

Memu-core **does not** expose its own network. It joins the existing one. Port `3100` is the only port published to the host, for the mobile app over Tailscale.

---

## 3. Baikal CalDAV contract

**memu-core expects:**

- Baikal is reachable at `http://memu_calendar:80` inside the Docker network.
- Username and password are passed via `CALDAV_USERNAME` and `CALDAV_PASSWORD`.
- Standard CalDAV discovery works — `/dav.php/calendars/<username>/` lists the calendars accessible to that user.

**memu-os provides:**

- A running Baikal container at the known hostname/port.
- Calendar credentials configured via the memu-os bootstrap wizard.

**What memu-core does with this contract:**

- Read-only for now: the calendar observer enumerates calendars, reads events for briefing assembly.
- Writes (creating events from stream cards) are planned but gated behind the calendar-write feature flag and have not been enabled in Tier 2 yet.
- Memu-core never modifies Baikal's database. All interaction is via CalDAV.

**If the contract breaks:**

| Break | Symptom |
|---|---|
| Baikal container stopped | Calendar strip on the Today tab shows "Calendar unavailable"; briefings degrade to events-less |
| Credentials rotated without updating memu-core `.env` | Auth failures logged; calendar disappears from briefings until creds updated |
| CalDAV path changes across a Baikal major version | Enumeration fails; memu-core must handle gracefully (fall back to empty calendar, not crash) |

---

## 4. Immich REST API contract (planned — not yet wired)

**Current state:** `ENABLE_PHOTO_OBSERVER=true` is set in `docker-compose.home.yml`, and `IMMICH_API_URL` / `IMMICH_API_KEY` env vars are plumbed, but no photo observer code is active. This section documents the **planned** contract so it can be implemented against a stable target.

**memu-core will expect:**

- Immich reachable at `http://memu_photos:2283` inside the Docker network.
- An API key with **read-only** scope on the family's library (created via Immich UI).
- The documented Immich REST endpoints for listing assets by date range and fetching asset metadata (EXIF, faces, location).

**memu-os provides:**

- Immich container, library rooted at `/mnt/memu-data/photos/`.
- Separate Immich Postgres database (NOT the one memu-core uses).

**What memu-core will do with this contract:**

- **Read only.** Never upload, delete, tag, or modify Immich assets.
- Pull date-ranged metadata for "photo memories" in morning briefings ("five years ago today, Robin's first swim lesson").
- Use face clusters (anonymised via the Digital Twin) for Spaces in the `people` category.

**If the contract breaks:**

| Break | Symptom |
|---|---|
| Immich unreachable | Photo-memory briefings silently skip the photo section; no crash |
| API key revoked | Same as above; log `401 Unauthorized` to the Privacy Ledger |
| Memu-core accidentally writes to Immich | **Violation.** Would corrupt family photo library. Write scope must be explicitly unavailable. |

---

## 5. Matrix / Synapse contract (placeholder — Tier 3 only)

Memu-core does not read from or write to Synapse in Tier 2. The mobile app is the primary channel; WhatsApp is an optional secondary channel.

In Tier 3 (fully docked into memu-os with local models), the plan is:

- Memu-core listens on a Matrix appservice bridge to Synapse rooms the family has invited it to.
- Memu-core never joins rooms uninvited.
- Memu-core never reads Synapse's database directly. All ingress is via the Matrix client-server API.

This section will be fleshed out when Tier 3 is scoped. For now: **no contract active, no integration code.**

---

## 6. File system bind-mount contract

**memu-core must preserve the following paths across container pulls, restarts, and redeployments:**

| Path inside container | Host path (Tier 2 / HP Z2) | Purpose | Loss impact |
|---|---|---|---|
| `/app/auth_info_baileys/` | Bind-mounted on host | WhatsApp session credentials (if enabled) | Re-pair WhatsApp from scratch; acceptable but annoying |
| `/app/documents/` | Bind-mounted on host | Scanned documents awaiting vision processing | In-flight extractions lost; user resubmits |
| `/app/spaces/<family_id>/` (Phase 2) | Bind-mounted on host, under `/mnt/memu-data/memu-core/spaces/` | **Synthesis pages — the family's compiled understanding.** Git repo per family. | **Catastrophic.** Family loses all compiled Spaces. Recoverable only from backup. |

**Backup scope (Phase 5 enforces):**

- `/mnt/memu-data/backups/` already receives nightly `pg_dumpall` of all Postgres databases (includes `memu_core`).
- Bind-mounted directories above must be added to the backup job's file-system pass.
- The watchdog at `/usr/local/bin/memu-watchdog.sh` must be extended to check the `memu_core` container health.

**If the contract breaks:**

- Pulling a new memu-core image without preserving mounts: session state, queued documents, and compiled Spaces all wiped. This is why the Phase 5 deployment procedure bind-mounts explicitly rather than relying on Docker volumes that could be pruned.

---

## 7. `family_id` scoping contract

This is a **database-level contract** that applies inside memu-core and bleeds out into every query the code makes.

**Rule:** Every table that stores family data must have a `family_id` column, and every query must scope by it. Even on single-tenant Hareesh deployments, hardcode `family_id = 1` in writes; queries still filter by the request's family context.

**Current state (2026-04-15):** `family_id` is **not yet wired** across the schema. This is a known gap for Phase 1 — `schema.sql` shows 0 occurrences. The migration to add `family_id NOT NULL DEFAULT 1` to every family-data table is a prerequisite for Tier 1 multi-tenancy and is tracked as a follow-on task inside the Phase 1 scope.

**Tables that must carry `family_id` once the column is added:**

- `profiles`
- `personas`
- `profile_channels`
- `profile_provider_keys` (BYOK — new, 006)
- `conversations`
- `messages`
- `context_entries`
- `stream_cards`
- `actions`
- `alerts`
- `synthesis_pages`
- `push_tokens`
- `privacy_ledger` (005 — already has `family_id` column ✓)
- `entity_registry` and any future `quasi_identifiers` table (Story 1.5)

**Tables exempt:**

- `audit_log` is per-profile, not per-family. Profile already keys family by foreign-key ancestry.
- `schema_migrations` is stack-wide, not family-scoped.

**If the contract breaks:**

| Break | Symptom |
|---|---|
| A new table is added without `family_id` | Quiet blocker for Tier 1 multi-tenancy. Retrofitting under load risks query regressions. Flag in PR review. |
| A query omits the `WHERE family_id = $1` clause | In single-tenant Tier 2, no symptom. In multi-tenant Tier 1, **catastrophic cross-family data leak.** This is why the column must be added before Tier 1 even if it's unused in Tier 2. |

**Enforcement plan:** Story 1.4 (Twin enforcement) and the family-scoping story that follows it will add a query-layer guard that refuses to execute a query against a family-data table without a `family_id` predicate. Until that guard ships, review discipline is the only defence.

---

## 8. Mobile app ↔ backend contract

**The mobile app expects:**

- The backend responds on `https://<host>:3100` over Tailscale (Tier 2) or over public HTTPS (Tier 1).
- All authenticated endpoints accept `Authorization: Bearer <apiKey>` where `apiKey` is issued by `/api/register`.
- Response shape for every endpoint: `{ data?: T, error?: string }`.
- The `ngrok-skip-browser-warning` header is accepted (for dev tunnels) but not required in production.

**The backend provides:**

- Stable API surface documented inline in `src/index.ts` route definitions.
- Versioned response shapes — breaking changes require a new endpoint path, not a silent schema change.

**If the contract breaks:**

- Mobile app on a user's phone updates less frequently than the backend. A backend schema change that drops a field can crash older clients. All response shape changes must be **additive**. Removal requires a deprecation cycle visible in the backlog.

---

## 9. Environment variable surface

The `.env.example` is the **entry-point contract** — a fresh clone can start from `cp .env.example .env`, fill in required values, and boot. Breaking this contract means a new deployer can't stand the stack up.

**Variables that are load-bearing:**

- `DATABASE_URL` — required. Shape differs between standalone and docked.
- `ANTHROPIC_API_KEY` — required for any LLM functionality (fallback when BYOK absent).
- `MEMU_BYOK_ENCRYPTION_KEY` — optional; if unset, BYOK is unavailable and deployment key is always used.
- `DB_PASSWORD` — required in docked mode; ignored in standalone mode.
- `GEMINI_API_KEY` — optional; used when router dispatches to `gemini-flash` or `gemini-flash-lite` aliases.
- `GOOGLE_*_CLIENT_ID` — optional; required only for Google Sign-In.
- `CALDAV_USERNAME` / `CALDAV_PASSWORD` — required if `ENABLE_CALENDAR_OBSERVER=true`.
- `IMMICH_API_KEY` — required once the photo observer is wired (Phase 2+).

**Variables that NEVER leave the deployment:**

- Encryption keys, API keys, OAuth secrets. Memu-core never transmits these anywhere. A violation here is a breach.

---

## Change management

When changing anything in this document:

1. Update the `Last updated` date at the top.
2. Bump a contract entry with a new sub-heading if the change is backward-incompatible, so `git blame` preserves the history.
3. If the change affects how memu-os exposes a service (rename, relocation, schema change in a shared resource), coordinate with the memu-os repo before merging — the corresponding file on that side is `memu/memu-os/CLAUDE.md`.

Contracts break quietly. The whole point of this document is that they don't.
