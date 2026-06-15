# Implementation Plan — #1023 PR #1019 housekeeping

**Issue:** #1023 · **Branch:** `1023-pr1019-housekeeping` · **Layer:** DX / build config (+ one unit smoke test)

Chore bag from the PR #1019 review. Scope = items 1–4; **item 5 deferred** (Erli not on `main`; "WooCommerce + Erli together or neither").

## Items

1. **Bump `@ungap/structured-clone` ≥ 1.3.1** (CWE-502 advisory on 1.3.0, transitive via the ESLint toolchain). Add `"@ungap/structured-clone": ">=1.3.1"` to root `package.json` `pnpm.overrides` (alongside the existing `typeorm` pin); `pnpm install` regenerates the lockfile (currently resolves 1.3.0 at 3 sites). AC: `pnpm-lock.yaml` no longer resolves 1.3.0; install clean.

2. **Declare the worker's imported-but-undeclared plugin deps.** `apps/worker/src/plugins.ts` imports `prestashop, allegro, ai, inpost, woocommerce, dpd-polska`; `apps/worker/package.json` declares only `prestashop` + `woocommerce`. Add `@openlinker/integrations-allegro`, `-ai`, `-inpost`, `-dpd-polska` (`workspace:*`), alphabetically. AC: every `plugins.ts` import is declared; `pnpm install` clean.

3. **Sweep the dead `publishConfig` block** from the 6 `libs/integrations/*/package.json` (`ai, allegro, dpd-polska, inpost, prestashop, woocommerce`). Each carries `private: true` **and** `publishConfig.access: public`; `private` wins so `publishConfig` is dead config (Erli dropped it in the #1019 review). Remove the 3-line `publishConfig` block (keep `private: true`). AC: `grep -rl publishConfig libs/integrations/*/package.json` empty; all 6 still parse.

4. **WooCommerce module-construction smoke test.** `WooCommerceIntegrationModule` is a top-level `DynamicModule` const = `createNestAdapterModule({ plugin: createWooCommercePlugin() })` with **no** unit coverage (the plugin *descriptor* is tested in `woocommerce-plugin.spec.ts`, but not the module composition; no plugin has this test yet — Erli was to be first). Add a `describe('WooCommerceIntegrationModule')` block to `woocommerce-plugin.spec.ts` importing the module and asserting the composed shape (`.module` defined, `.imports` populated). Importing the const exercises `createNestAdapterModule` at load → a composition regression fails at unit speed. AC: new test green; `pnpm --filter @openlinker/integrations-woocommerce test` passes.

## Deferred
- **Item 5** (`async` shorthand for `createCapabilityAdapter`): reviewer requires applying to WooCommerce + Erli *together*; Erli isn't on `main`. Lands with the Erli skeleton. Noted on the issue.

## Validation / risks
- **No runtime/schema/API change**; no migration. Items 1–3 are config; item 4 is additive test.
- **Risk:** lockfile churn from the override (item 1) — review the diff is scoped to `@ungap/structured-clone`. Worker dep additions are `workspace:*` (no version churn).
- **Phase 3.5 pre-implement gate:** unnecessary — no new ports/services/tokens/ORM/barrels; pure config + one additive smoke test.
- **Gate:** `pnpm install` → `pnpm lint && type-check && test`.
