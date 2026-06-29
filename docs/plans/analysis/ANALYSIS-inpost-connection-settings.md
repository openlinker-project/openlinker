# Pre-implement gate — InPost connection settings FE (#771)

**Plan:** `docs/plans/implementation-plan-inpost-connection-settings.md`
**Gated:** 2026-06-28 · read-only, no code/plan edits

## Verdict: ✅ READY

No Critical contract breaks; no reuse collisions. Every new artifact is confirmed
absent; every change is additive. Two Warnings (FE contract-test count bumps + a
small additive factory-helper export) — both already anticipated in the plan.

The plan's headline value is **scope correction**: #771 (written 2026-05-17 against
the spec's intended design) assumes OAuth, a trigger model, and a PS-module dropdown
that the *shipped* adapter (#764/#765/#768) does not implement. The plan builds the
real contract (apiToken + senderAddress config) and descopes the rest with reasons —
this gate confirms those reasons against the tree.

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `inpost-structured-section.tsx` (+test) | **NEW** | inpost plugin has only `index.ts` + `inpost-webhook-runbook.{tsx,test.tsx}`. |
| `inpost-credentials-panel.tsx` (+test) | **NEW** | absent. |
| `inpost-setup.route.tsx` | **NEW** | absent; mirror `prestashop-setup.route.tsx`. |
| `inpost-connection-tester.adapter.ts` (+spec) | **NEW** | no tester in `libs/integrations/inpost/.../adapters/`; confirms `POST /connections/:id/test` currently 400s for InPost. |
| InPost fields in `edit-connection.schema.ts` | **NEW (extend)** | grep for `environment`/`organizationId`/`senderAddress` → none; only PS-side `inpostPsModuleType` exists. Additive `StructuredField`/`StructuredConfigPatch` extension. |
| `index.ts` slots (`setupCard`/`StructuredConfigSection`/`CredentialsPanel`/`build.routes`) | **CHANGE (additive)** | currently only `displayName` + `ConnectionActions`. |
| `inpost-plugin.ts` tester registration | **CHANGE (additive)** | `register(host)` hook already exists (registers 5 other registries); `connectionTesterRegistry` is on `HostServices`. One added line. |
| `ConnectionTesterPort` | **REUSE** | existing port (`libs/core/src/integrations/domain/ports/connection-tester.port.ts`); tester implements it — no signature change. |

## Backward-compat findings

**Critical:** none. No core-barrel export removed/renamed, no port signature changed, no DTO shape broken, no Symbol token touched, no ORM/migration.

**Warnings:**
1. **FE contract tests — count bumps (will fail lint/test if missed).** Adding the `/connections/new/inpost` lazy setup route requires bumping `EXPECTED_LAZY_ROUTE_COUNT` (currently **45 → 46**) in `apps/web/src/app/routes/route-lazy.test.ts`, and adding a `handle.crumb` to the route + the matching `route-handle.test.ts` assertion. Plan Step 4 calls this out.
2. **Factory-helper export (additive).** `BASE_URLS` / `extractConfig` / `resolveApiToken` in `inpost-adapter.factory.ts` are currently **not exported**. The tester should reuse them — export them (additive, no break) rather than duplicating the base-URL map. Trivial.

**`check:invariants` exposure:** low. InPost is already in `apps/web/src/plugins/index.ts` and `apps/api/src/plugins.ts`, so **no jest-integration `moduleNameMapper` churn** and no `plugins.ts` edit. The tester lives in `libs/integrations/inpost` and imports `ConnectionTesterPort` from `@openlinker/core/integrations` (already a dependency) — no new cross-context deny pattern. No `platformType` literal dispatch in shared FE code (registry-driven plugin).

## Open questions

None blocking. Confirmed-resolved:
- Connection-test → include the backend tester (user decision); probe `GET /v1/points?per_page=1`, `maxRetries: 0`.
- Credentials → ShipX `apiToken` (write-only), not OAuth.
- Descoped (trigger model / PS-module / capability toggles / PL catalog) → documented in the plan + to be noted on #771 so ACs aren't silently dropped.

One thing to decide at implementation, not blocking: whether `senderAddress` is collected only in the guided **setup route** or also editable via `StructuredConfigSection` on the edit form (plan does both — fine, mirrors PrestaShop).
