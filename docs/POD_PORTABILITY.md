# Pod Portability — Cross-household membership

**Last updated:** 2026-04-18
**Audience:** A family who already runs Memu and now needs to share with someone whose Pod lives elsewhere — a partner, a parent who moved in, an adult child returning from university. Plain language; no Solid expertise assumed.

This document explains what cross-household Pod portability **does**, what it **doesn't** do, and the exact end-to-end test the Memu team runs before any release that touches Story 3.4.

---

## The problem

Hareesh marries Rach. Rach already runs her own Memu deployment on her own hardware. Her personal Spaces — `Person/Rach`, `Routine/Morning run`, `Commitment/Therapy` — live in *her* Pod. When she moves into the household, two wrong answers are easy to reach:

1. **Copy everything across.** Now there are two copies of Rach. They drift. Whose is canonical?
2. **Make her abandon her Pod.** Now she has lost her data sovereignty the moment she joined a household. The opposite of what Memu is for.

The right answer: Rach **stays the source of truth for her own Spaces**, and the household **reads them from her Pod by reference**. If she leaves, her data leaves with her — because it was hers the whole time.

---

## What Pod portability does

- Lets one Memu deployment (the "household") read individual Spaces from another Memu deployment (the "member's Pod") over standard Solid HTTP, with proper authentication.
- Uses **per-Space grants** rather than blanket access. Rach grants the household read access to `Routine/Morning run`; she does not grant read access to her therapy notes. The household sees exactly what she chose to share, nothing more.
- Treats foreign people as first-class entities — the Twin auto-registers any WebID surfaced in a granted Space's `people[]`, so the household's Claude never sees a real WebID URL leaked into an anonymised prompt.
- Makes leaving safe by default. A "Leave" action is a *grace-period* state (default 30 days, configurable), not an instant cut. During the grace period the leave can be cancelled cleanly. After the grace period expires, all grants are revoked, all cached Space content is dropped, and the member row is marked `left`.
- Supports rejoin. A `left` member can be re-invited; a fresh row is created. No zombie state.

## What Pod portability does **not** do

- It does not copy Spaces from the member's Pod into the household. Cached content is purely a performance/offline cache; revoking a grant or finalising a leave drops it.
- It does not give the household write access to the member's Pod. Read-only, per Space.
- It does not federate authentication. The member still authenticates against their own Pod's OIDC issuer; the household trusts the WebID they present.
- It does not handle physical Pod drives (LUKS USB) — that's Story 3.5.
- It does not currently surface a UI for the *granting* side. Today the member calls `POST /api/households/members/:id/grants` directly (or via the household admin during invite). Story 3.5 / Tier-2 wizard work will add a grant flow on the member's deployment.

---

## The lifecycle

```
       inviteMember()                acceptInvite()
  ─────────────────────────▶  ─────────────────────────▶
invited                       active
                                  │
                                  │  initiateLeave(graceDays)
                                  ▼
                              leaving  ◀──── cancelLeave()
                                  │
                                  │  grace_period elapsed
                                  │  (cron: daily 04:30)
                                  ▼
                              left  (terminal)
                                  │
                                  │  inviteMember() again
                                  ▼
                              invited (new row)
```

State transitions are enforced by `canTransition()` in `src/households/membership.ts`. Illegal jumps (e.g. `invited → leaving`) raise `MembershipError('illegal_transition')` rather than corrupting state.

### What happens when a leave is finalised

When the daily cron at `30 4 * * *` Europe/London (`src/index.ts`, "Daily household sweep") finds a `leaving` member whose `leave_grace_until` has passed:

1. `finaliseLeave(memberId)` runs in a transaction:
   - Marks the member `left`.
   - Sets `leave_finalised_at`.
   - Cascade-revokes all that member's `pod_grants` rows (sets `status='revoked'`, `revoked_at=now`).
2. `dropAllCacheForMember(memberId)` deletes every row in `external_space_cache` for that member. The household stops seeing the member's content immediately.
3. The member's `entity_registry` entries are **not** deleted. Past references in other Spaces (`Routine/Morning run` mentions Rach by `Person-2`) remain coherent. The Twin still translates `Rach → Person-2` so historic synthesis pages don't break.

If the household admin needs to drop a member faster than the grace period, `DELETE /api/households/members/:id` does the same finalisation immediately (no grace).

---

## The end-to-end test

This is the scripted scenario the Memu team runs against two real deployments before any release that touches Story 3.4. It is deliberately manual rather than automated — the value is the cross-deployment behaviour, not the Postgres state, and a real two-process setup catches integration bugs that mocks miss.

**Setup:**

- **Deployment A (household).** A clean Memu deployment with one admin profile (`hareesh`). `MEMU_BASE_URL=https://family-a.memu.test`. Postgres database `memu_core_a`.
- **Deployment B (Sam's personal Pod).** A second clean Memu deployment with one admin profile (`sam`). `MEMU_BASE_URL=https://sam.memu.test`. Postgres database `memu_core_b`. On B, create one Space `Person/sam` (the autobiography Space) and one Space `Routine/morning_run` mentioning `Person/sam`. Both `family`-visibility from Sam's perspective.
- A WebID for Sam: `https://sam.memu.test/people/sam#me`. Sam's Solid OIDC issuer is `https://sam.memu.test/oidc`.

**Steps and expected outcomes:**

1. **Invite (admin on A).**
   ```
   POST https://family-a.memu.test/api/households/members
   { "memberWebid": "https://sam.memu.test/people/sam#me",
     "memberDisplayName": "Sam",
     "leavePolicyForEmergent": "retain_attributed",
     "gracePeriodDays": 30 }
   ```
   Expect: `200 { id, status: "invited" }`. New row in `household_members`.

2. **Accept (Sam, calling A).**
   ```
   POST https://family-a.memu.test/api/households/members/:id/accept
   ```
   Expect: status flips to `active`. `accepted_at` populated.

3. **Record grants (Sam, calling A).** Sam tells deployment A which of his Spaces it may read.
   ```
   POST https://family-a.memu.test/api/households/members/:id/grants
   { "spaceUrl": "https://sam.memu.test/spaces/person/sam" }
   POST .../grants
   { "spaceUrl": "https://sam.memu.test/spaces/routine/morning_run" }
   ```
   Expect: two `pod_grants` rows, both `status='active'`.

4. **Sync (admin or Sam, calling A).**
   ```
   POST https://family-a.memu.test/api/households/members/:id/grants/sync
   ```
   Expect: A fetches both Spaces over HTTPS from B (Solid client). Response shows `[{kind:"fresh", spaceUrl:"…/sam"}, {kind:"fresh", spaceUrl:"…/morning_run"}]`. `external_space_cache` populated. `pod_grants.last_etag` and `last_modified_header` populated. `entity_registry` on A now contains a `person` row for Sam's WebID with `detected_by='auto_pod_grant'`.

5. **Reflect (admin on A).** Run a chat turn on A that asks "Who is Sam?" or "What's Sam's morning routine?".
   Expect: A's Claude call sees only the anonymised label (`Person-N`) for Sam. The Twin guard logs `twin_verified=true`. The response references the Space content correctly. **The raw WebID URL never appears in the prompt or the response.**

6. **Re-sync (no changes).**
   ```
   POST .../grants/sync
   ```
   Expect: response shows `[{kind:"not_modified", spaceUrl:"…"}, …]`. `pod_grants.last_synced_at` updates; cache rows are not rewritten. (Verifies `If-None-Match` round-trip.)

7. **Edit on B.** Edit `Routine/morning_run` on B (e.g. add `04:00` start time). Re-run sync on A.
   Expect: response shows `kind:"fresh"` for `morning_run`, `kind:"not_modified"` for `sam`. Cache row for `morning_run` updated; `sam` untouched.

8. **Leave with grace (Sam, calling A).**
   ```
   POST https://family-a.memu.test/api/households/members/:id/leave
   { "leavePolicyForEmergent": "retain_attributed", "gracePeriodDaysOverride": 30 }
   ```
   Expect: `status='leaving'`. `leave_grace_until` set 30 days out. Grants still active. Cache still present. Sam can still be referenced in chats — historic continuity holds.

9. **Cancel leave (Sam, calling A).**
   ```
   POST https://family-a.memu.test/api/households/members/:id/cancel-leave
   ```
   Expect: `status='active'`. `leave_grace_until` cleared. No data loss.

10. **Leave with zero grace (Sam, calling A).**
    ```
    POST .../leave  { "gracePeriodDaysOverride": 0 }
    ```
    Expect: `status='left'` immediately. `leave_finalised_at` set. All `pod_grants` rows now `revoked`. `external_space_cache` empty for this member. Querying A's Claude about Sam's morning routine now returns "no information" rather than the cached content. (Verifies cascade cleanup on instant-leave.)

11. **Rejoin.** Repeat steps 1–4. Expect a *new* `household_members` row with a fresh id; the previous `left` row is preserved as audit. New grants record cleanly. Sync works. The Twin still has Sam's `Person-N` registered from before, so historic synthesis pages remain coherent.

12. **Force-remove from admin (negative path).** With Sam in `active` state:
    ```
    DELETE https://family-a.memu.test/api/households/members/:id
    ```
    Expect: as instant-leave but called by the household admin rather than the member. Same cleanup. (This is the path used when an adult child cuts contact and the parent needs to revoke without their cooperation.)

If every step passes, Story 3.4 is shippable. If any step regresses, the failing step gets a unit test against `src/households/membership.test.ts` or `src/spaces/external_sync.test.ts` before the fix lands.

---

## Failure modes worth knowing

- **B is offline during sync.** `syncGrant` returns `{kind:'error', reason:'fetch_failed', message:…}`. The grant is not revoked, the cache (if any) is not dropped, and the next sync retries. The household degrades gracefully: it answers from the cache it already has.
- **B revoked Sam's Space (returns 401/403/404).** Same shape: `{kind:'error', reason:'unauthorized'|'http_error'}`. Today the household keeps the cache; in a future release the household admin will get a `care_standard_lapsed`-style stream card prompting them to revoke the grant explicitly.
- **B served an unparseable body.** `{kind:'error', reason:'invalid_json'|'invalid_turtle'}`. Same disposition as above — cache preserved, sweep continues to the next grant.
- **A and B diverge on the WebID.** If Sam regenerates his WebID slug on B, A's `pod_grants.space_url` will start 404'ing. The household admin must invite Sam afresh under his new WebID and revoke the old grants. The old `entity_registry` row remains for historic continuity; a fresh `Person-M` is allocated for the new WebID.

---

## What this still doesn't do

- **No grant UI on the member's deployment.** Today, recording a grant is a curl call. Story 3.5 / Tier-2 wizard polish will add a "Share this Space with another household" affordance on B itself.
- **No selective-attribute sharing.** Granting access to `Person/Sam` shares the whole Space. Field-level redaction is a Tier-3 capability and not on this roadmap.
- **No DPoP-bound bearer tokens between deployments.** Outbound Solid client requests use plain `Authorization: Bearer` if a token is supplied. Inbound Solid surface (Story 3.3d) does verify DPoP. Symmetric DPoP-on-outbound is on the 3.5/wizard track.
- **No replay cache for incoming DPoP `jti`.** `iat` window is the practical brake until a TTL store lands.
