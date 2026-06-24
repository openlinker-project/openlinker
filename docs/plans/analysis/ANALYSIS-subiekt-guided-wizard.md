# Pre-Implement Readiness Gate: Subiekt Guided Wizard (#1199)

**Plan**: `docs/plans/implementation-plan-subiekt-guided-wizard.md`
**Date**: 2026-06-24
**Scope checked**: live `apps/web/src` tree on `1199-subiekt-wizard` (fresh from `origin/main`)

## Verdict: ✅ READY

Purely additive FE-only plan. No reuse collisions, no contract-surface breaks. Every surface the wizard consumes exists on `main` and matches the plan's assumptions verbatim.

---

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `plugins/subiekt/index.ts` (`subiektPlugin`) | **NEW (confirmed absent)** | `find apps/web/src -iname "*subiekt*"` → no hits |
| `plugins/subiekt/subiekt-setup.route.tsx` | **NEW** | no hits (as above) |
| `pages/connections/subiekt-setup-page.tsx` | **NEW** | no hits |
| `features/connections/components/subiekt-setup-form.tsx` + `.schema.ts` | **NEW** | no hits |
| `definePlugin` helper | **ALREADY EXISTS → reuse** | `apps/web/src/plugins/define-plugin.ts` |
| `OpenLinkerPlugin` / `PlatformContribution` / `PlatformSetupCard` contract | **ALREADY EXISTS → reuse** | `apps/web/src/shared/plugins/plugin.types.ts` |
| `useCreateConnectionMutation` | **ALREADY EXISTS → reuse** | `features/connections/hooks/use-create-connection-mutation.ts` (same-feature relative import) |
| `useTestConnectionMutation` | **ALREADY EXISTS → reuse** | `features/connections/hooks/use-test-connection-mutation.ts` (same-feature; not barrel-exported — fine, the form lives inside the feature) |
| `connections.api.create()` / `.test()` | **ALREADY EXISTS → reuse** | `features/connections/api/connections.api.ts:47,72` |
| Subiekt BE adapter / connection-tester | **ALREADY EXISTS → reuse** | `libs/integrations/subiekt` (`subiekt.invoicing.v1`, `platformType:'subiekt'`, `SubiektConnectionTesterAdapter`) |

No artifact the plan marks NEW exists; no artifact it reuses is missing.

---

## Backward-compatibility findings

| Surface | Result |
|---|---|
| Top-level barrels | **No break.** No symbol removed/renamed. `plugins/index.ts` only **appends** `subiektPlugin`. |
| Port method signatures | **N/A.** No port touched. |
| DTO shapes | **No break.** `CreateConnectionInput` consumed as-is — confirmed shape `{ name; platformType; config; credentials?; credentialsRef?; adapterKey?; enabledCapabilities? }` (`connections.types.ts:60-75`). The wizard's mapper fits this exactly (name, `platformType:'subiekt'`, `config:{bridgeBaseUrl, timeoutMs?}`, `adapterKey:'subiekt.invoicing.v1'`, optional `credentials:{bridgeToken}`, `enabledCapabilities` omitted). |
| Symbol tokens | **N/A.** No `*.tokens.ts` touched. |
| ORM schema / migrations | **N/A.** No entity change → no migration. |
| `check:invariants` | **No trip expected.** No cross-context core import; no deep-barrel import; plugin reads `CreateConnectionInput` via the connections public surface; no `platformType` literal-equality dispatch outside `plugins/subiekt/`. **One mechanical contract test must be updated, not a violation:** `route-lazy.test.ts` `EXPECTED_LAZY_ROUTE_COUNT` is **41** (`route-lazy.test.ts:65`) → bump to **42** (already Step 9 in the plan). `route-handle.test.ts` is satisfied by the route's `handle.crumb`. |

No Critical items. One Warning-class item (the route-count bump) is already an explicit plan step.

---

## Confirmed facts (load-bearing assumptions verified against the tree)

- `enabledCapabilities?: CoreCapability[]` is **strict on the well-known core set** (`connections.types.ts` comment, #576). The plan **omits** it on create → BE defaults to the adapter manifest's supported set (`['Invoicing']`). This sidesteps the open question of whether `'Invoicing'` is in the FE `CoreCapability` union — confirmed the right call.
- Current `plugins` array order: `prestashop, allegro, dpd, inpost, woocommerce, erli` (`plugins/index.ts:52-57`). Appending `subiektPlugin` after `erliPlugin` only affects card sequence; uniqueness invariant holds (`id`/`platformType` `'subiekt'` are both unused).
- `bridgeBaseUrl` allowed protocols are `http`/`https` (LAN bridge) and the IMDS guard is BE-authoritative — the plan's TR note matches the merged `SubiektConnectionConfigDto`.

---

## Open questions

None blocking. The two tech-review notes (numeric coercion of `timeoutMs`; required-not-optional `bridgeBaseUrl`) are already folded into Phase 1 Step 1 of the plan. Implementation can proceed.
