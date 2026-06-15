# Implementation Plan — #990: FE Erli connection setup UI + web plugin registration

**Date**: 2026-06-15 · **Status**: Ready to implement (turnkey) · **Effort**: M · **Branch**: `990-erli-connection-fe` (off `origin/main` — R4 resolved: FE uses only the generic connection API already in `main`; #982 is BE-only). Wave-4.

> **Why this is a plan, not code (this session):** the FE follows an elaborate per-platform convention (form + page + route + registration + tests) in `apps/web`, where the org subagent spend-limit (hit mid-session) removed the ideal delegation path and solo FE iteration (vitest/RTL) couldn't be validated cheaply. This plan is code-grounded and turnkey: mirror WooCommerce (the closest precedent — credentials-based, no OAuth) scoped to Erli's single API key.

## Scope (issue #990 ACs)
- Operator can create an Erli connection from web admin (enter API key, see test result, see Active status).
- Erli appears in the connection-type picker, driven by the plugin registry (no hard-coding / no `platformType` literal dispatch).
- FE tests (`*.test.tsx`); no new ESLint/type errors.

## Exact files (mirror WooCommerce; Erli = single `apiKey` credential + optional `baseUrl` config)

1. **`apps/web/src/plugins/erli/index.ts`** — `definePlugin({ id:'erli', platformType:'erli', build:{ routes:[erliSetupRoute] }, platform:{ displayName:'Erli', setupCard:{ title:'Erli', description:'Connect your Erli seller account with your Shop API key.', to:'/connections/new/erli', badge:'API key' }, CredentialsPanel: ErliCredentialsPanel } })`. (No `StructuredConfigSection` needed — Erli has only an optional `baseUrl`; can omit or add a tiny one. Mirror `plugins/woocommerce/index.ts`.)
2. **`apps/web/src/plugins/erli/erli-setup.route.tsx`** — `RouteObject` `path:'connections/new/erli'`, `handle.crumb {group:'Platform', title:'Connect Erli'}`, lazy-import `ErliSetupPage`. (Mirror `woocommerce-setup.route.tsx`.)
3. **`apps/web/src/pages/connections/erli-setup-page.tsx`** — page shell composing the setup form. (Mirror `woocommerce-setup-page.tsx`.)
4. **`apps/web/src/features/connections/components/erli-setup-form.tsx`** — the create form: a single **API key** field (+ optional advanced `baseUrl`), name field, submit via the generic `useCreateConnectionMutation` with `{ platformType:'erli', name, config:{ baseUrl? }, credentials:{ apiKey } }`, then "Test connection" via `useTestConnectionMutation`, surfacing the `ConnectionTestResult`. (Mirror `woocommerce-setup-form.tsx` / `dpd-setup-form.tsx`, simplified to one credential.) Use RHF + Zod (`apiKey` required non-empty) per FE conventions.
5. **`apps/web/src/plugins/erli/components/erli-credentials-panel.tsx`** — edit-time API-key rotation via `useUpdateConnectionCredentialsMutation({ connectionId, credentials:{ apiKey } })`; honour `connection.credentialsBacked` (read-only affordance when env-backed). (Mirror `woocommerce-credentials-panel.tsx`, one field.)
6. **Register** `erliPlugin` in `apps/web/src/plugins/index.ts` (import + add to the `plugins` array — single edit point; `assertUniquePluginInvariants` validates id/platformType uniqueness).
7. **Tests** (`*.test.tsx`, vitest + RTL): setup-form renders + submits API key + shows test result; credentials-panel rotates; plugin registry includes erli (picker shows it). Mirror `woocommerce-*.test.tsx` + `platform-picker.test.tsx`.

## Status surfacing
Already registry-driven: `connections-list-page.tsx` + `ConnectionEntityLabel` key off `platformType` + `usePlatform`/`usePlatforms` and `toStatusTone(ConnectionStatus)` — no Erli-specific code needed once the plugin is registered. (Verify the list renders the Erli `displayName` + Active/error tone.)

## Runtime caveat (R4)
Builds + unit-tests off `main`. A *live* "Test connection" only succeeds once the Erli BE stack (incl. #982 connection tester/validators) is deployed to the target API — the FE calls the generic `/connections/:id/test`, which dispatches to the BE Erli connection tester registered at `erli.shopapi.v1`.

## Gate (FE-specific — NOT the integrations dep-build)
`pnpm install --prefer-offline` then `pnpm --filter @openlinker/web type-check + lint + test` (`tsc -b` / `vitest run`). No `@openlinker/*` workspace dep-build (apps/web has none).

## Risks
- Convention drift vs the per-platform setup-form/page/route pattern — mitigated by mirroring WooCommerce file-for-file.
- `platformType` literal dispatch is ESLint-banned outside `plugins/<platformType>/` — keep all Erli-specific logic inside `plugins/erli/` + the registry-driven surfaces.

## Related
- Wave-4 meta-plan · `plugins/woocommerce/*` (precedent) · #982 (BE connection API) · spec #978 (User story 1 Connect, FE half)
