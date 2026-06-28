# Implementation Plan — InPost connection settings FE (#771)

> Connection-settings UI for InPost connections, **scope-corrected** against the
> shipped ShipX adapter (#764/#765/#768). The issue (written 2026-05-17 against the
> spec's intended design) assumes OAuth + a trigger model + a PS-module dropdown that
> the shipped backend does not implement. This plan builds what the real adapter
> contract supports and descopes the rest with reasons.

## 1. Understand the task

**Goal.** Let an operator fully configure an InPost connection from the UI: environment,
organization id, sender address, and the ShipX API token — with validation, a guided
setup card, and the (already-shipped) webhook runbook.

**Layer.** Frontend (`apps/web` plugin contribution) + connections-feature schema. One
**optional** small backend slice (connection-test tester) is the only non-FE item — see
fork below.

**Non-goals (descoped with reasons):**
- **OAuth credentials** → adapter uses a single Bearer `apiToken` (`inpost-credentials.types.ts`); build that, not OAuth.
- **Trigger-model dropdown** → no `triggerModel` config field exists; webhook+scheduler are passive (#768/#772). Persisting it = dead config. Defer until the backend models it.
- **PS InPost module dropdown** → already shipped by **#1155** on the *PrestaShop* connection (`inpostPsModuleType`); the InPost adapter never reads it.
- **Capability toggles** → InPost declares one capability (`ShippingProviderManager`); nothing meaningful to toggle.
- **PL catalog** → i18n is a no-op seam (English fallback only); use `t('inpost.settings.*', 'English')` per the Subiekt precedent. A real PL catalog is deferred infra (#612 follow-up).

## 2. Research — shipped contract (verified)

- **Config DTO** `libs/integrations/inpost/src/application/dto/inpost-connection-config.dto.ts`: `environment: 'sandbox'|'production'`, `organizationId: string`, `senderAddress: { name?, email, phone, address: { street, buildingNumber, city, postCode (NN-NNN), countryCode (ISO2) } }`. Validator registered at `inpost.shipx.v1`.
- **Credentials** `inpost-credentials.types.ts`: `{ apiToken: string }` — ShipX Bearer token, resolved from `credentialsRef`, validated in `inpost-adapter.factory.ts`.
- **Manifest** `inpost-plugin.ts`: `adapterKey: 'inpost.shipx.v1'`, `platformType: 'inpost'`, `supportedCapabilities: ['ShippingProviderManager']`.
- **FE pattern**: PrestaShop is the worked example — `setupCard` + `build.routes` setup route + `StructuredConfigSection` (RHF + `syncStructuredToJson`) + `CredentialsPanel` (rotate via `PUT /connections/:id/credentials`). Config persists via `PATCH /connections/:id` `config` jsonb; credentials persist separately. Schema + `mergeStructuredIntoConfig` live in `features/connections/components/edit-connection.schema.ts`.
- **Connection-test**: generic FE button already exists (`ConnectionActionsPanel` → `POST /connections/:id/test`); **no InPost backend tester registered**.

## 3. Design — recommended scope (FE-focused)

Mirror the PrestaShop plugin shape:

1. **`InpostStructuredSection`** (`StructuredConfigSection`) on the edit form — environment select, organizationId, and the nested senderAddress fields, each wired through `syncStructuredToJson`. Nested `senderAddress.*` mapped via a `mergeStructuredIntoConfig` clause (whole-object serializer, mirroring Subiekt/Allegro nested patterns).
2. **`InpostCredentialsPanel`** (`CredentialsPanel`) — enter/rotate the ShipX `apiToken` via `useUpdateConnectionCredentialsMutation` (`{ apiToken }`).
3. **`setupCard`** + a guided **setup route** (`/connections/new/inpost`, `build.routes`) collecting name + apiToken + the config, POSTing to `/connections` with `platformType: 'inpost'`, `adapterKey: 'inpost.shipx.v1'`.
4. **Zod schema** additions in `edit-connection.schema.ts` matching the DTO (email, `^\d{2}-\d{3}$` postCode, ISO2 country, required fields), delete-on-empty semantics.
5. Keep the existing **webhook runbook** `ConnectionActions` (#768).
6. **i18n**: all labels via `t('inpost.settings.*', 'English fallback')`.
7. **Tests**: structured-section + credentials-panel + setup-route (renderWithProviders), schema validation, route-lazy/route-handle contract bumps.

### Connection-test — DECIDED: include the backend tester (Option B)
The generic FE test button already renders + calls `POST /connections/:id/test`, but no InPost tester is registered, so `ConnectionService.testConnection` throws `400 "Connection testing is not supported for adapter inpost.shipx.v1"`. We add the tester so the button is meaningful. Low surface — confirmed:
- `ConnectionTesterPort.test(connection, credentialsResolver): Promise<ConnectionTestResult>` (`libs/core/src/integrations/domain/ports/connection-tester.port.ts`); result `{ success, status?, message, latencyMs }`.
- InPost plugin **already has** `register(host)` and `connectionTesterRegistry` is on `HostServices` — no host edits.
- Probe: `GET /v1/points?per_page=1` (authenticated, read-only, already used by `findPickupPoints`). Build the `InpostHttpClient` from `environment`→baseURL + resolved `apiToken`, reusing the factory's helpers (export `BASE_URLS`/`extractConfig`/`resolveApiToken` if needed rather than duplicating).
- Pattern to mirror: `AllegroConnectionTesterAdapter` (`maxRetries: 0`, map success/exception → result + latency).

## 4. Step-by-step plan

1. `edit-connection.schema.ts` — add InPost structured fields + Zod + `mergeStructuredIntoConfig` clause (nested `senderAddress`). *AC:* schema round-trips a created connection; validation matches the DTO.
2. `plugins/inpost/components/inpost-structured-section.tsx` (+ test) — env select, organizationId, senderAddress fields; `syncStructuredToJson`. *AC:* renders, persists to `config`, validates.
3. `plugins/inpost/components/inpost-credentials-panel.tsx` (+ test) — enter/rotate `apiToken`. *AC:* rotation calls `PUT /credentials` with `{ apiToken }`.
4. `plugins/inpost/inpost-setup.route.tsx` (+ route-lazy/route-handle count bumps) — guided create. *AC:* creates a working InPost connection from the UI.
5. `plugins/inpost/index.ts` — add `setupCard`, `StructuredConfigSection`, `CredentialsPanel`, `build.routes`. *AC:* slots resolve in EditConnectionForm + PlatformPicker.
6. **Backend tester** `libs/integrations/inpost/src/infrastructure/adapters/inpost-connection-tester.adapter.ts` (+ spec) — `implements ConnectionTesterPort`; builds `InpostHttpClient` (env→baseURL + resolved `apiToken`), probes `GET /v1/points?per_page=1` with `maxRetries: 0`, maps success/exception → `ConnectionTestResult` (success, status, message, latencyMs). *AC:* OK on valid creds; `success:false` + status on 401/403; never throws. Reuse factory helpers (`BASE_URLS`/`extractConfig`/`resolveApiToken`) — export them if currently private rather than duplicating the base-url map.
7. **Register the tester** in `libs/integrations/inpost/src/inpost-plugin.ts` `register(host)`: `host.connectionTesterRegistry.register('inpost.shipx.v1', new InpostConnectionTesterAdapter());`. *AC:* `POST /connections/:id/test` no longer 400s for InPost.
8. Operator guide note in `docs/integrations/inpost/` (if present) — configuring an InPost connection + the test button.
9. Quality gate: `pnpm --filter @openlinker/web type-check lint test` + `pnpm --filter @openlinker/integrations-inpost test`; full `pnpm lint`/`type-check`/`test`.

## 5. Validate
- **Architecture:** plugin contribution only; no host-internal imports; no `platformType` literal dispatch in shared code (registry-driven).
- **Naming:** `kebab-case.tsx` components, `*.schema.ts`, `*.route.tsx`, `*.test.tsx`.
- **State:** server→TanStack Query, form→RHF+Zod, config jsonb via PATCH, credentials via PUT.
- **Security:** `apiToken` is write-only credentials (never config, never echoed); no secrets in FE.
- **Responsive:** mobile/tablet per style guide (forms `max-width` per breakpoint); "open on desktop to edit" affordance already host-provided.
- **Scope honesty:** the descoped items get a closing note on #771 so the issue's ACs aren't silently dropped.
