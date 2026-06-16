# Pre-implement Analysis — #754 FakeSubiektBridgeAdapter

**Plan:** `docs/plans/implementation-plan-754-fake-subiekt-bridge.md`
**Gated:** 2026-06-17 · against worktree `754-fake-subiekt-bridge-adapter` @ `590cac51`

## Verdict: ✅ READY

No Critical findings. Greenfield package — every artifact is genuinely new, no contract surface is touched (additive `tsconfig.base.json` paths only), and the two invariants the tech-review flagged as gate risks both resolve cleanly. One minor open question (dep trimming) that doesn't block.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `libs/integrations/subiekt/` package | **NEW** | directory absent |
| `SubiektBridgeClient` (contract interface) | **NEW** | 0 hits in `libs`/`apps` |
| bridge DTOs (`BridgeIssueInvoiceRequest`, …) | **NEW** | 0 hits |
| `SubiektBridgeUnreachableError` / `SubiektRejectedError` | **NEW** | 0 hits |
| `FakeSubiektBridgeAdapter` | **NEW** | 0 hits |
| `runSubiektBridgeContractTests` | **NEW** | 0 hits |
| `@openlinker/integrations-subiekt` tsconfig paths | **NEW** | 0 occurrences in `tsconfig.base.json` |
| `./testing` package-export pattern | **REUSE (precedent)** | `libs/integrations/inpost/package.json` ships `exports["./testing"]` + `src/testing.ts` + `src/testing/fake-*.adapter.ts` — mirror it |
| package skeleton (package.json/tsconfig/jest) | **REUSE (template)** | mirror `libs/integrations/erli/` (#1019) verbatim, retargeting the jest `moduleNameMapper` |

## Backward-compat findings

**Critical:** none. No barrel export, port signature, DTO, Symbol token, or ORM schema is removed/renamed. No migration. No `apps/*/plugins.ts` edit.

**Warnings:**
1. **`check-libs-build-scripts`** scans every `libs/integrations/*` package for a non-empty `scripts.build`. The new package **must** carry `"build": "tsc -b"` — satisfied by the Erli-mirrored `package.json`. *(Handled in plan step 1.)*
2. **`tsconfig.base.json`** gains two `@openlinker/integrations-subiekt` + `/*` paths entries — additive, no break.

**Invariants that do NOT fire (verified):**
- `check-create-adapter` — validates the scaffolder *templates* (`scripts/create-adapter-templates/`, tmpdir, `EXPECTED_FILE_COUNT=14`); it does **not** scan real integration packages. A hand-built package cannot trip it.
- `check-jest-integration-mappers` (#917) — only fires for `@openlinker/integrations-*` packages imported in `apps/{api,worker}/src/plugins.ts`. #754 adds **no** plugins.ts entry → no mapper line needed.
- `check-cross-context-imports` — the bridge contract + fake are Subiekt-native and import nothing from `@openlinker/core/*` (neutral↔bridge mapping is #753). No cross-context import to validate.
- `check-service-interfaces` — scoped to `libs/core/src/**/application/services`; N/A.

## Open questions

1. **Workspace deps / tsconfig references — erli-parity vs trim-to-actuals.** The Erli template declares `@openlinker/{core,plugin-sdk,shared}` deps + tsconfig `references`. #754's fake + contract are self-contained (no core import yet), so those would be *declared-but-unused* until #753. Either keep erli-parity (cheap forward-compat for #753's runtime adapter) or trim to actuals now. Non-blocking; recommend **keep parity** to avoid churn when #753 lands. Verify `tsconfig.eslint.json` covers `libs/integrations/**` (glob) so the new package is type-aware-linted — the build/lint gate will surface it if not.

Plan is implementation-ready.
