# Pre-Implementation Analysis: Fix Misleading "Adapter Not Recognized" Copy in ConnectionCapabilitiesPanel

**Plan**: `docs/plans/implementation-plan-connection-capabilities-panel-invoicing.md`
**Issue**: [#1287](https://github.com/openlinker-project/openlinker/issues/1287)
**Date**: 2026-07-02

## Verdict: READY

No reuse collisions, no contract breaks. The plan's own research was independently re-verified against the live tree and confirmed accurate in every claim checked. One low-severity documentation-staleness item was found that the plan did not mention; it does not block implementation.

---

## Reuse Findings

| Plan artifact | Classification | File |
|---|---|---|
| `'Invoicing'` added to backend `CoreCapabilityValues` | **ALREADY EXISTS** | `libs/core/src/integrations/domain/types/adapter.types.ts:22-36` — confirmed present, alongside `'ProductPublisher'` / `'CategoryProvisioner'` (ADR-024) which the plan correctly scopes out |
| `CreateConnectionDto` / `UpdateConnectionDto` accepting `'Invoicing'` | **ALREADY EXISTS** | `apps/api/src/integrations/http/dto/update-connection.dto.ts:56` and `create-connection.dto.ts` both use `@IsIn(CoreCapabilityValues, { each: true })` — `'Invoicing'` is already a legal value, no DTO change needed |
| KSeF / Subiekt / Infakt declare `supportedCapabilities: ['Invoicing']` | **ALREADY EXISTS** | `libs/integrations/ksef/src/ksef-plugin.ts:45`, `libs/integrations/subiekt/src/subiekt-plugin.ts:38`, `libs/integrations/infakt/src/infakt-plugin.ts:38` — all three confirmed exactly as the plan describes |
| `CORE_CAPABILITY_VALUES` FE array (target of the widen) | **PARTIAL → extend** | `apps/web/src/features/connections/api/connections.types.ts:25-31` — currently 5 entries, missing `'Invoicing'` (and `'ProductPublisher'`/`'CategoryProvisioner'`, correctly deferred by the plan) |
| `CAPABILITY_HELP` exhaustive map | **PARTIAL → extend** | `ConnectionCapabilitiesPanel.tsx:22-28` — `Record<CoreCapability, string>`, will fail `pnpm type-check` the moment `CoreCapability` widens until `Invoicing` is added, exactly as the plan predicts |
| Broken fallback copy (`’` escape sequence + "adapter is not recognized") | **ALREADY EXISTS (bug)** | `ConnectionCapabilitiesPanel.tsx:114-117` — confirmed: the literal six-character escape sequence `’` is present verbatim in the JSX text node, and the false "not recognized" claim is present |
| Existing fallback-copy test | **ALREADY EXISTS → must update** | `ConnectionCapabilitiesPanel.test.tsx:96-105`, asserts `/adapter is not recognized/` — confirmed, matches plan's Phase 2 Step 1 target exactly |

No new port, service, DI token, or ORM entity is proposed — nothing to check against `libs/core/**` for collisions. This is consistent with the plan's own scoping (pure FE data + copy fix).

---

## Backward-Compatibility Findings

No Critical items.

| Surface | Check | Result |
|---|---|---|
| FE `CoreCapability` union widen | Any exhaustive `Record<CoreCapability, ...>` consumer besides `CAPABILITY_HELP`? | **Checked** — grepped every `CoreCapability` usage across `apps/web/src`. Only `ConnectionCapabilitiesPanel.tsx`'s `CAPABILITY_HELP` is an exhaustive `Record`; `trigger-sync-dialog.types.ts` uses it as an optional field (`requiredCapability?: CoreCapability`), not exhaustively. No other breakage. |
| Backend DTO / ORM / migration | Does adding `'Invoicing'` to the FE list require any backend change? | **No** — backend has accepted `'Invoicing'` in `enabledCapabilities` since ADR-026 shipped. Zero backend files need to change, confirmed by direct read of both DTOs. |
| `check:invariants` (cross-context imports, service-interface check) | Does this trip any repo-wide invariant script? | **No** — `apps/web/**` is explicitly out of scope for `check-cross-context-imports` per `docs/architecture-overview.md § Scope` ("`apps/web/**` ... don't import from `@openlinker/core/*` and stay outside the walker"). No `libs/core` files touched, so `check-service-interfaces` is unaffected. |

---

## Open Questions / Findings Not in the Plan

1. **Stale KSeF comments referencing the now-fixed gap (low severity, non-blocking).** Two comments explicitly cite the FE's `CORE_CAPABILITY_VALUES` *not* including `'Invoicing'` as the reason the KSeF create-form omits `enabledCapabilities` from its payload:
   - `apps/web/src/features/connections/components/ksef-setup-form.tsx:12-14` — "the FE does not send them because `Invoicing` is not in the well-known `CORE_CAPABILITY_VALUES`."
   - `apps/web/src/features/connections/components/ksef-setup.schema.ts:152-154` — same claim, inline in `toCreateConnectionInput`.

   After this fix, that premise becomes false — `Invoicing` **will** be in `CORE_CAPABILITY_VALUES`. The *behavior* stays correct either way (omitting `enabledCapabilities` on create still works: the backend defaults to the adapter's full manifest set, `['Invoicing']`, which is what's wanted), so this is not a functional bug and not in the plan's stated file list. But the comments will actively mislead the next reader into thinking there's still a capability-list gap forcing the omission, when the real reason (if any) would need to be re-justified or the field could now be sent explicitly.

   **Recommendation**: add a one-line touch-up to Phase 1 (or a fast-follow) updating these two comments to stop citing the stale premise — e.g. rephrase to "capabilities default server-side from the adapter manifest; the FE create form does not need to send them explicitly." This is a same-spirit, in-scope-adjacent fix (same root cause: FE capability-list drift) and low-risk to bundle, but does not block shipping the plan as scoped if the author prefers to defer it — it's a comment, not a contract.

   Subiekt's equivalent comment (`subiekt-setup.schema.ts:15,74`) does **not** cite `CORE_CAPABILITY_VALUES` and needs no change. No Infakt FE setup form exists yet, so nothing to touch there.

2. **No other blocking findings.** Every reuse and compatibility claim in the plan's §4 research section was independently re-verified byte-for-byte against the live tree (adapter keys, DTO decorators, `CoreCapabilityValues` array contents, ADR file existence) and found accurate.

---

## Summary for implementer

Proceed as planned. The two file edits (`connections.types.ts`, `ConnectionCapabilitiesPanel.tsx`) plus the test updates are sufficient and collision-free. Optionally fold in the two stale-comment touch-ups in `ksef-setup-form.tsx` / `ksef-setup.schema.ts` (§ Open Questions #1) while in the area, since they reference the exact premise this plan invalidates — but this is a nice-to-have, not a gate blocker.
