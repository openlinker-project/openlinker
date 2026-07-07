# Implementation Plan: Erli category & parameter browsing via an Erli-owned Allegro client-credentials token

**Date**: 2026-07-07
**Status**: Ready for Review
**Estimated Effort**: 4-6 days (3 sub-tasks, sequential dependency)

**Design reference**: An approved UI mockup (checkbox-reveal credentials panel + category/parameters wizard steps, built from live `apps/web` design tokens) is shared in the artifact link attached to the tracking epic issue.

---

## 1. Task Summary

**Objective**: Let an operator creating an Erli offer pick a category from a browsable tree and fill category-specific parameters (e.g. "Stan"/condition), the same way the Allegro single-offer wizard already works — without requiring the operator to own or connect a real Allegro seller account.

**Context**: Erli "borrows" Allegro's category/attribute taxonomy by design (ADR-023 §40/§83, ADR-025, #1045) — `ErliOfferManagerAdapter` implements `TaxonomyBorrower` but not `CategoryBrowser`/`CategoryParametersReader`, so today's Erli offer wizard has only a plain-text Category ID field and no parameter step. Diagnosis (this conversation) confirmed: (1) Allegro's `/sale/categories` and `/sale/categories/{id}/parameters` are public catalog data reachable via `grant_type=client_credentials` — no seller/user OAuth context required; (2) nothing in this codebase supports that grant type today (only per-seller `refresh_token`); (3) the existing generic capability-resolution machinery (`CategoriesCacheService.getAllegroCategories`, `GET /listings/connections/:connectionId/categories/:categoryId/parameters`) already works for *any* `connectionId` whose resolved adapter implements the relevant capability — so once Erli's own adapter can serve these two methods, no new HTTP endpoints are needed.

**Classification**: Integration (Erli) + Interface (FE wizard) — see [ADR-031](../architecture/adrs/031-erli-allegro-category-catalog-via-client-credentials.md) for the full architectural decision and rejected alternatives (no cross-plugin dependency, no shared system-wide credential in v1).

---

## 2. Scope & Non-Goals

### In Scope
- A new, Erli-owned Allegro `client_credentials` HTTP client (`AllegroCategoryCatalogClient`) — token acquisition/caching + `fetchCategories`/`fetchCategoryParameters` calls against Allegro's public REST host.
- Two new optional fields on Erli connection credentials: `allegroClientId`, `allegroClientSecret`; one new non-secret optional field on Erli connection config: `allegroCategoryAccessEnabled: boolean`, written/cleared alongside the credentials pair.
- `ErliAdapterFactory` wiring so the constructed `ErliOfferManagerAdapter` *instance* exposes working `fetchCategories`/`fetchCategoryParameters` only when both credential fields are present and valid — reflected correctly through the existing `isCategoryBrowser`/`isCategoryParametersReader` structural guards. **Note**: `connection.supportedCapabilities` is a static, per-`adapterKey` manifest value, not computed per-connection-instance — it does NOT reflect this configuration state (discovered during #1383 implementation; see ADR-031 "Correction"). `allegroCategoryAccessEnabled` in `config` is the FE-visible signal instead.
- Erli connection wizard/edit form: checkbox-gated reveal of Client ID / Client Secret fields (per approved mockup).
- Erli single-offer wizard (`erli-create-offer-wizard.tsx`): new Category step (reusing `CategoryPicker`) and Category-parameters step (reusing `CategoryParametersStep`/`useCategoryParametersQuery`), gated on `connection.config.allegroCategoryAccessEnabled`, with fallback to today's plain-text field when absent.

### Out of Scope
- Any change to `OfferBuilderService.buildOfferParameters` or `AttributeProjectionService` merge logic — already destination-capability-agnostic (confirmed in diagnosis) and requires no changes.
- Any change to `ErliOfferManagerAdapter.buildExternalAttributes` (`cmd.parameters` → `source:"allegro"` wire mapping) — already correct.
- Bulk-offer wizard changes — its `supportedCapabilities.includes('CategoryBrowser')` gate (#1367) is unaffected by this feature (that field is static per-`adapterKey`, so it stays `false` for Erli regardless of per-connection Allegro configuration — a pre-existing bulk-wizard limitation, unchanged and explicitly out of scope here); its existing test suite must still pass unmodified (see §9) to confirm no regression, but it will not gain the new category/parameters UX.
- A shared, system-wide (non-tenant) Allegro app credential — deferred per ADR-031 alternatives.
- Any change to Allegro's own seller-OAuth (`refresh_token`) flow or `AllegroAdapterFactory`.
- Database migrations — no new tables/columns; new fields live inside the existing encrypted `credentialsRef` JSON blob for the Erli connection (`integration_credentials.credentialsCiphertext`), same mechanism as `apiKey` today.

### Constraints
- Must not introduce a dependency from `@openlinker/integrations-erli` on `@openlinker/integrations-allegro` (ADR-031).
- Must not regress the #1367 bulk-wizard capability gate for unconfigured Erli connections.
- Three sub-tasks land sequentially on one integration branch (`1 → 2 → 3`); one final PR to `main` for review.

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/erli/`) for capability + credentials; Interface (`apps/web/src/features/listings`, `apps/web/src/plugins/erli`) for the two FE surfaces. No CORE changes.

**Capabilities Involved**:
- `CategoryBrowser` (`libs/core/src/listings/domain/ports/capabilities/category-browser.capability.ts`) — `fetchCategories(parentId?)`.
- `CategoryParametersReader` (`libs/core/src/listings/domain/ports/capabilities/category-parameters-reader.capability.ts`) — `fetchCategoryParameters({categoryId})`.
- `TaxonomyBorrower` (already implemented by Erli) — unchanged.

**Existing Services Reused** (no changes required):
- `CategoriesCacheService.getAllegroCategories` (`apps/api/src/categories/categories-cache.service.ts`) — capability-generic, resolves via `IIntegrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')` + `isCategoryBrowser`.
- `GET /listings/connections/:connectionId/categories/:categoryId/parameters` (`apps/api/src/listings/http/listings.controller.ts:407`) — capability-generic, `isCategoryParametersReader`.
- `GET /connections/:connectionId/mappings/options/source/categories` (`apps/api/src/mappings/http/mapping-options.controller.ts`) — delegates to `CategoriesCacheService`, capability-generic.
- FE: `CategoryPicker` (`apps/web/src/features/listings/components/CategoryPicker.tsx`), `useCategoryParametersQuery` (`apps/web/src/features/listings/hooks/use-category-parameters-query.ts`), `category-parameters-step.tsx`.
- `OfferBuilderService.buildOfferParameters` (`libs/core/src/listings/application/services/offer-builder.service.ts:311-360`) — already merges `overrides.parameters` regardless of destination capability.

**New Components Required**:
- `AllegroCategoryCatalogClient` (new, `libs/integrations/erli/src/infrastructure/http/allegro-category-catalog-client.ts`) — owns `client_credentials` token acquisition/cache + the two GET calls.
- `ErliCredentials.allegroClientId` / `.allegroClientSecret` (extend `libs/integrations/erli/src/domain/types/erli-connection.types.ts`).
- `ErliOfferManagerAdapter` constructor extension to accept an optional catalog client and conditionally expose the two capability methods on the instance.
- `ErliConnectionCredentialsShapeValidatorAdapter` extension for the two new optional fields (both-or-neither).
- FE: extended `ErliCredentialsPanel` (checkbox + two fields), new Category + Category-parameters steps in `erli-create-offer-wizard.tsx`, plus a small connection-create-time equivalent if the guided setup route collects credentials up front (see Phase 3, Step 3.1).

**Core vs Integration Justification**: Everything new is Erli-plugin-local (`libs/integrations/erli`) or Erli-FE-local. CORE's `CategoryBrowser`/`CategoryParametersReader` port contracts are unchanged and untouched — Erli simply becomes a *conditional* implementer of already-existing capability interfaces, exactly the pattern Allegro and PrestaShop already use ("adapters declare capabilities they support via `implements`"). No new CORE port is needed because the existing capability shape already matches what Erli needs to expose.

---

## 4. External / Domain Research

### External System — Allegro Developer Portal
- **Authentication**: `POST /auth/oauth/token` on the Allegro **web** host (`allegro.pl` prod / `allegro.pl.allegrosandbox.pl` sandbox — mirrors `getAllegroWebBaseUrl(environment)` already used by `AllegroTokenRefreshService`), `grant_type=client_credentials`, `Authorization: Basic base64(client_id:client_secret)`, no body params beyond `grant_type`. Response: `{ access_token, expires_in, token_type }` — **no `refresh_token`** (client-credentials tokens are re-requested on expiry, not refreshed).
- **API calls**: `GET /sale/categories?parent.id={parentId}` and `GET /sale/categories/{categoryId}/parameters` on the Allegro **REST** host (`api.allegro.pl` prod / `api.allegro.pl.allegrosandbox.pl` sandbox), `Authorization: Bearer {app_token}`, `Accept: application/vnd.allegro.public.v1+json`.
- **Rate limits**: standard Allegro per-app request budget applies to the app token like any other; no special-case handling beyond the existing retry/backoff conventions used by `AllegroHttpClient`.
- **Known pitfall**: category/parameter data is public and identical for every caller — cache aggressively (mirrors `AllegroOfferManagerAdapter.fetchCategoryParameters`'s existing global, non-per-connection cache key `allegro:cat-params:{categoryId}` and `CategoriesCacheService`'s 24h DB cache, which is keyed by `connectionId` today — see Phase 1 Step 1.3 for the cache-key decision).

### Internal Patterns
- `AllegroConnectionTokenState` (`libs/integrations/allegro/src/infrastructure/http/allegro-connection-token-state.ts`) is the reference shape for proactive-refresh-window + single-flight-refresh + failure-cooldown token management — reused as a *design pattern*, not imported (per ADR-031, no cross-plugin dependency). The Erli-owned client re-implements a simplified version (no reactive-401 path needed since client-credentials tokens don't 401 on expiry the same way — a fresh token is requested proactively before the cached one's `expiresAt`).
- `ErliAdapterFactory` (`libs/integrations/erli/src/application/erli-adapter.factory.ts`) is a plain (non-`@Injectable`) class, one instance's `createAdapters`/`createHttpClient` builds per-connection state — the new catalog client follows the same "plain class, constructed per connection" shape.
- `ErliConnectionCredentialsShapeValidatorAdapter` / `ErliConnectionConfigShapeValidatorAdapter` (`libs/integrations/erli/src/infrastructure/adapters/`) — hand-rolled validators (no class-validator), registered against the host's two shape-validator registries in `erli-plugin.ts`'s `register(host)`.

---

## 5. Questions & Assumptions

### Open Questions
- Does the Erli **guided setup route** (`erliSetupRoute`, credential collection at connection-creation time) need the checkbox+fields too, or is post-create edit (via `ErliCredentialsPanel`) sufficient for v1? **Assumption below resolves this as: edit-only for v1** — simpler, and the feature is explicitly "optional but recommended," not required at connect time.
- Should `allegroClientSecret` rotation go through the same `useUpdateConnectionCredentialsMutation` payload as `apiKey`, merging all three fields in one PUT, or a separate mutation? **Assumption: same PUT, one merged credentials object** — mirrors how `apiKey` rotation already works and avoids a second credentials-write path.

### Assumptions
- `allegroClientId` and `allegroClientSecret` both live in `ErliCredentials` (encrypted, alongside `apiKey`) — the secret values never need to be FE-visible. **Superseded assumption** (corrected post-#1383): the FE still needs *some* per-connection-visible signal to decide which wizard branch to render, and `connection.supportedCapabilities` turned out not to serve that purpose (it's a static per-`adapterKey` manifest value — see ADR-031 "Correction"). The actual signal is a separate, non-secret `ErliConnectionConfig.allegroCategoryAccessEnabled?: boolean`, written/cleared by the backend in the same request that writes/clears the credentials pair (the write path — whatever endpoint ends up handling the credentials update in #1383/#1384's implementation — updates both the credentials blob and the config flag together, so they can't drift out of sync under normal operation).
- "Both or neither" is enforced at the **credentials shape validator** level (reject if exactly one of the two is present) rather than deferred to runtime — fail closed at save time with a clear 400, rather than silently degrading.
- Sandbox vs production Allegro host selection for the catalog client follows the **same `environment` config convention** already used by `AllegroConnectionConfig.environment` — added as a new optional `ErliConnectionConfig.allegroEnvironment?: 'sandbox' | 'production'` (defaults to `'production'`), since Erli's own config today has no such field and category data differs between Allegro sandbox and production catalogs.
- No new DB migration: reusing the existing `credentialsRef` blob and `ErliConnectionConfig` JSON — both already schema-less JSON columns.

### Documentation Gaps
- None blocking — `docs/architecture/adrs/023-*.md` and `025-*.md` already establish the borrowed-taxonomy vocabulary this plan extends.

---

## 6. Proposed Implementation Plan

### Sub-task 1 (Phase 1): Backend — Erli-owned Allegro client-credentials catalog client

**Goal**: A standalone, testable client that gets an Allegro app token and fetches categories/parameters. No Erli adapter wiring yet.

**Steps**:

1. **`ErliConnectionConfig.allegroEnvironment` type**
   - **File**: `libs/integrations/erli/src/domain/types/erli-connection.types.ts`
   - **Action**: Add `allegroEnvironment?: 'sandbox' | 'production'` to `ErliConnectionConfig`; add `allegroClientId?: string` and `allegroClientSecret?: string` to `ErliCredentials`. Update the file's header doc comment to mention the new optional Allegro app-credential fields.
   - **Acceptance**: `pnpm --filter @openlinker/integrations-erli type-check` passes; no other file breaks (both fields optional).

2. **`AllegroCategoryCatalogClient`**
   - **File**: `libs/integrations/erli/src/infrastructure/http/allegro-category-catalog-client.ts` (new)
   - **Action**: Class with constructor `(clientId: string, clientSecret: string, environment: 'sandbox' | 'production')`. Methods:
     - `private async ensureToken(): Promise<string>` — returns cached token if `expiresAt` is more than 60s away (mirrors `AllegroConnectionTokenState`'s `TOKEN_REFRESH_WINDOW_MS`), else POSTs `grant_type=client_credentials` to the Allegro web host's `/auth/oauth/token` and caches `{ token, expiresAt }` on the instance.
     - `async fetchCategories(parentId?: string): Promise<OfferCategory[]>` — `GET /sale/categories?parent.id={parentId}` on the Allegro REST host, maps the response to the neutral `OfferCategory` shape (mirror `AllegroOfferManagerAdapter.fetchCategories`'s response mapping — read that method for the exact field mapping, don't reinvent it).
     - `async fetchCategoryParameters(categoryId: string): Promise<CategoryParameter[]>` — `GET /sale/categories/{categoryId}/parameters`, maps to neutral `CategoryParameter[]` (mirror `AllegroOfferManagerAdapter.fetchCategoryParametersRaw`'s mapping).
   - Reuse the exception classes already in `libs/integrations/erli/src/domain/exceptions/` (`ErliNetworkException` for fetch failures, a new `ErliAuthenticationException`-style rejection for a non-2xx token response — check if `ErliAuthenticationException` fits or needs a dedicated message; do not invent a new exception file if an existing one covers "credentials rejected").
   - **Acceptance**: unit-testable in isolation with mocked `fetch`; no NestJS/DI dependency (plain class, matches `ErliAdapterFactory`'s own style).
   - **Dependencies**: Step 1.

3. **Caching decision**
   - **File**: same as above, or a thin wrapper if the cache needs to be shared across catalog-client instances for the same connection.
   - **Action**: Given category/parameter data is public and identical for every caller (confirmed by `AllegroOfferManagerAdapter`'s own global cache-key comment), do **not** invent a new per-connection cache layer inside `AllegroCategoryCatalogClient` itself — `CategoriesCacheService`'s existing 24h DB-backed cache (keyed by `connectionId` today) already sits in front of `adapter.fetchCategories`, and the parameters endpoint has no cache today at the controller layer (check `listings.controller.ts:407-460` — if there's no cache, note this as a pre-existing gap shared with Allegro, not something this plan needs to newly solve). In-memory token caching inside the client instance is sufficient; do not add a second data cache.
   - **Acceptance**: no duplicate caching layers introduced.

4. **Unit tests**
   - **File**: `libs/integrations/erli/src/infrastructure/http/__tests__/allegro-category-catalog-client.spec.ts` (new)
   - **Action**: Mock `fetch`. Cover: (a) token acquisition on first call, (b) token reuse within the freshness window, (c) token re-acquisition after expiry, (d) `fetchCategories` maps response fields correctly, (e) `fetchCategoryParameters` maps response fields correctly, (f) non-2xx token response throws a clear, typed exception, (g) network failure (fetch throws) throws `ErliNetworkException`.
   - **Acceptance**: `pnpm --filter @openlinker/integrations-erli test` green.

---

### Sub-task 2 (Phase 2): Backend — Erli connection credentials + adapter wiring + validators

**Goal**: An Erli connection can store Allegro app credentials; when present, its resolved `OfferManagerPort` adapter instance genuinely implements `CategoryBrowser`/`CategoryParametersReader` (verified via the `is*` guards and the real HTTP endpoints, not via `connection.supportedCapabilities` — see the "Note" under §2 In Scope), and the FE-visible `allegroCategoryAccessEnabled` config flag is kept in sync with that state.

**Steps**:

1. **`ErliOfferManagerAdapter` conditional capability wiring**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts`
   - **Action**: Add an optional constructor parameter `allegroCategoryCatalog?: AllegroCategoryCatalogClient`. **Do not** add `CategoryBrowser`/`CategoryParametersReader` to the class's static `implements` clause (per ADR-031 — this must stay a per-instance, runtime-reflected capability, not a static one). Instead, in the constructor, when `allegroCategoryCatalog` is provided:
     ```ts
     if (allegroCategoryCatalog) {
       this.fetchCategories = (parentId) => allegroCategoryCatalog.fetchCategories(parentId);
       this.fetchCategoryParameters = ({ categoryId }) => allegroCategoryCatalog.fetchCategoryParameters(categoryId);
     }
     ```
     Declare `fetchCategories?: CategoryBrowser['fetchCategories']` and `fetchCategoryParameters?: CategoryParametersReader['fetchCategoryParameters']` as optional instance properties (typed, not implemented in the class body) so `isCategoryBrowser`/`isCategoryParametersReader`'s `typeof adapter.fetchCategories === 'function'` check is satisfied only when actually wired.
   - **Acceptance**: an `ErliOfferManagerAdapter` constructed without the catalog client has `fetchCategories === undefined`; constructed with it, `isCategoryBrowser(adapter)` and `isCategoryParametersReader(adapter)` both return `true`.
   - **Dependencies**: Phase 1.

2. **`ErliAdapterFactory` resolution**
   - **File**: `libs/integrations/erli/src/application/erli-adapter.factory.ts`
   - **Action**: In `createAdapters`, after resolving `ErliCredentials`, check `credentials.allegroClientId` + `credentials.allegroClientSecret` (both non-empty strings). If present, construct an `AllegroCategoryCatalogClient` (environment from `config.allegroEnvironment ?? 'production'`) and pass it to the `ErliOfferManagerAdapter` constructor; otherwise pass `undefined`. Log (debug level) whether category-catalog access is active for this connection — mirrors the existing `Logger` usage pattern in this file's sibling adapters.
   - **Acceptance**: unit test (extend `libs/integrations/erli/src/application/__tests__/erli-adapter.factory.spec.ts`) covering both branches — with and without Allegro app credentials.
   - **Dependencies**: Step 2.1.

3. **Credentials shape validator**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-connection-credentials-shape-validator.adapter.ts`
   - **Action**: After the existing `apiKey` check, validate: if `allegroClientId` or `allegroClientSecret` is present, **both** must be present and non-empty strings (reject with a clear `InvalidCredentialsShapeException` message otherwise, e.g. "allegroClientId and allegroClientSecret must both be provided together, or both omitted").
   - **Acceptance**: unit test covering all four combinations (neither / both / only-id / only-secret).
   - **Dependencies**: Step 1.1.

4. **Config validator — `allegroEnvironment`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-connection-config-shape-validator.adapter.ts`
   - **Action**: If `allegroEnvironment` is present, must be exactly `'sandbox'` or `'production'`.
   - **Acceptance**: unit test covering valid/invalid/absent.
   - **Dependencies**: Step 1.1.

5. **Config field + write-path sync for the FE-visible signal** *(added post-#1383 review — see ADR-031 "Correction")*
   - **Files**: `libs/integrations/erli/src/domain/types/erli-connection.types.ts`, `libs/integrations/erli/src/infrastructure/adapters/erli-connection-config-shape-validator.adapter.ts`, plus whichever endpoint/service handles the Erli connection credentials update (identify the existing generic "update connection credentials" mechanism at implementation time).
   - **Action**: Add `allegroCategoryAccessEnabled?: boolean` to `ErliConnectionConfig`; validate it's a boolean when present (mirrors the `allegroEnvironment` validator in Step 4). Whatever code path writes `allegroClientId`/`allegroClientSecret` into credentials must, in the same operation, set `config.allegroCategoryAccessEnabled = true` when both are being set to non-empty values, and `false` (or remove the field) when either is cleared — so the flag can never silently drift from the actual credential state under normal write paths.
   - **Acceptance**: unit test confirming the config write happens atomically alongside the credentials write in both directions (enable and disable).
   - **Dependencies**: Steps 2.3, 2.4.

6. **Error handling at existing call sites**
   - **Files**: `apps/api/src/categories/categories-cache.service.ts`, `apps/api/src/listings/http/listings.controller.ts`
   - **Action**: These are unchanged in logic (still resolve via `getCapabilityAdapter` + `is*` guards), but since a *misconfigured* connection now correctly has `fetchCategories === undefined` (guard returns `false`, existing "doesn't support" branches fire — 501 for parameters, empty array for categories), **no new error-handling path is actually needed here**. Verify this explicitly with a manual/integration check (Phase 2 acceptance) rather than assuming — the whole point of the per-instance wiring in Step 2.1 is that misconfigured connections behave exactly like today's "adapter doesn't implement this capability" case, not like a new runtime exception.
   - **Acceptance**: confirmed via the integration test in Step 2.7 that an Erli connection *without* Allegro credentials gets a 501 from the parameters endpoint and `[]` from the categories endpoint — identical to today's behavior, not a new error shape.

7. **Integration test**
   - **File**: `apps/api/test/integration/listings/erli-category-catalog.int-spec.ts` (new)
   - **Action**: Using the existing Erli fake-HTTP-client test pattern (`erli-fake-http-client.ts` / `erli-test-offer-manager.helper.ts`, #991) as a reference — but note this new client (`AllegroCategoryCatalogClient`) talks to Allegro, not Erli, so it needs its **own** fake HTTP seam (fake `fetch` or a small interface it depends on) rather than reusing the Erli fake client. Cover: (a) Erli connection with valid Allegro app credentials → `GET /listings/connections/:id/categories/:categoryId/parameters` returns data; (b) Erli connection without → returns 501 (today's existing behavior, unchanged); (c) `connection.config.allegroCategoryAccessEnabled` is `true` only in case (a) — `connection.supportedCapabilities` does NOT vary between the two cases (it's static per-`adapterKey`) and asserting on it here would be a false-positive test.
   - **Acceptance**: `pnpm test:integration` green for this suite.
   - **Dependencies**: Steps 2.1-2.6.

---

### Sub-task 3 (Phase 3): Frontend — connection wizard checkbox + offer wizard category/parameters steps

**Goal**: Ship the two UI fragments per the approved mockup.

**Steps**:

1. **`ErliCredentialsPanel` extension**
   - **File**: `apps/web/src/plugins/erli/components/erli-credentials-panel.tsx`
   - **Action**: Add the checkbox "Browse Allegro categories when creating Erli offers" (native `<input type="checkbox">`, `accent-color` styled per existing convention — no wrapper div per project convention) gating a disclosure panel with Client ID / Client Secret `Input` fields (secret masked, with show/hide toggle per mockup). On save, merge `{ apiKey, allegroClientId, allegroClientSecret }` into the same `useUpdateConnectionCredentialsMutation` call (only include the two new fields if the checkbox is checked; omit both — not empty-string — when unchecked, so the backend validator's "both or neither" rule is satisfied by omission). Show the existing `rotate.error` `Alert` on validation failure (e.g. wrong credentials rejected by the shape validator) — reuse, don't reinvent.
   - **Acceptance**: `apps/web/src/plugins/erli/components/erli-credentials-panel.test.tsx` (new or extended) covers: checkbox toggle reveals/hides fields; submit with only one of the two fields filled shows a client-side validation error before hitting the API (Zod-level, mirrors "both or neither"); successful submit calls the mutation with all three fields.
   - **Dependencies**: Phase 2 (credentials shape validator error messages should be stable strings the FE can pattern-match if needed, though the primary validation is client-side).

2. **Category step in `erli-create-offer-wizard.tsx`**
   - **File**: `apps/web/src/features/listings/components/erli/erli-create-offer-wizard.tsx`
   - **Action**: Read `connection.config.allegroCategoryAccessEnabled` (the connection object is already available in this component per the existing `categoryId` field's `resolved` logic around line 168). When `true`, render `CategoryPicker` (reusing the same component/props Allegro's wizard uses) in place of the current plain `<Input>` (line ~413-420), writing the selected leaf category id into the same `categoryId` form field. When `false`, keep today's plain-text input **plus** add the fallback hint block from the mockup ("Add Allegro category browsing to this connection to pick from a list instead" with a link to the connection's edit page).
   - **Acceptance**: `erli-create-offer-wizard.test.tsx` extended with two scenarios (capability present/absent) asserting the correct sub-component renders.
   - **Dependencies**: Step 3.1 is not a hard dependency (this step only needs the capability flag, not credential UI) — can be built in parallel with 3.1, merged together on the sub-task-3 branch.

3. **Category-parameters step in `erli-create-offer-wizard.tsx`**
   - **File**: `apps/web/src/features/listings/components/erli/erli-create-offer-wizard.tsx`, `apps/web/src/features/listings/components/erli/erli-create-offer.schema.ts`
   - **Action**: Add `parameters` to `erliCreateOfferSchema`/`ErliCreateOfferValues` (currently absent per diagnosis). Add a new wizard step (only present when `CategoryBrowser` capability is active and a category is selected) rendering the existing `category-parameters-step.tsx` component fed by `useCategoryParametersQuery(connectionId, categoryId)` — same hook Allegro's wizard already uses, no new hook needed. On submit, set `overrides.parameters` from the step's collected values (mirrors how `overrides.categoryId` is already set at line 246) — `OfferBuilderService.buildOfferParameters` already merges this correctly server-side (confirmed in diagnosis, no BE change needed).
   - **Acceptance**: `erli-create-offer-wizard.test.tsx` covers: parameters step appears only when capability is active; required-parameter validation blocks submit (mirrors Allegro's wizard behavior); submitted payload includes `overrides.parameters`.
   - **Dependencies**: Step 3.2 (category must be selectable first).

4. **Stepper label update**
   - **File**: `apps/web/src/features/listings/components/erli/erli-create-offer-wizard.tsx`
   - **Action**: `ERLI_STEP_LABELS` grows from `['Variant', 'Offer details', 'Review']` to a capability-conditional array — `['Variant', 'Offer details', 'Category', 'Category parameters', 'Review']` when capability is active, unchanged otherwise. Update `SetupStepper` usage and the `stepIndex` logic accordingly (mirror how `AllegroCreateOfferWizard.tsx` computes its step array/indices, since it's the same `SetupStepper` component).
   - **Acceptance**: stepper renders the right label set and current-step indicator in both branches; existing `erli-create-offer-wizard.test.tsx` snapshot/assertions updated.
   - **Dependencies**: Steps 3.2, 3.3.

5. **`needsProductParameters` flag**
   - **File**: `apps/web/src/features/listings/components/erli/erli-create-offer-wizard.tsx` (line ~190 per diagnosis)
   - **Action**: The hardcoded `needsProductParameters: false` passed to the shared `offerValidation.validateRow` contract should become capability-conditional (`connection.config.allegroCategoryAccessEnabled`), so the shared validation contract correctly reflects Erli's now-variable parameter requirements.
   - **Acceptance**: unit test asserting the flag flips with capability presence.
   - **Dependencies**: Step 3.2.

---

## 7. Alternatives Considered

See [ADR-031 § Alternatives considered](../architecture/adrs/031-erli-allegro-category-catalog-via-client-credentials.md#alternatives-considered) for the full architectural alternatives analysis (require a real Allegro connection, cross-plugin dependency, shared system-wide credential, always-static capability implementation). Summarized: the chosen design (Erli-owned client, per-instance dynamic capability wiring) was the only option that avoided both a new cross-plugin dependency and a regression of the #1367 bulk-wizard capability gate.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE changes; existing capability ports/guards reused as designed.
- ✅ No cross-plugin package dependency (ADR-031).
- ✅ Hexagonal layering respected: new HTTP client + credential fields live in `libs/integrations/erli/{domain,infrastructure}`; FE changes confined to `features/listings` and `plugins/erli`.

### Naming Conventions
- ✅ `AllegroCategoryCatalogClient` — descriptive, no `*Adapter`/`*Port` suffix needed (it's a plain HTTP client, not a capability adapter itself, mirroring `ErliHttpClient`'s own naming).
- ✅ New exceptions (if any) added to `libs/integrations/erli/src/domain/exceptions/`, matching `*.exception.ts` convention.

### Existing Patterns
- ✅ Validated against `AllegroTokenRefreshService` (token-refresh shape), `ErliAdapterFactory` (per-connection construction shape), `CategoriesCacheService` (capability-generic resolution — confirmed via direct file read, not assumed).

### Risks
- **Regression risk on #1367**: the entire design of Step 2.1 (per-instance, not per-class, capability exposure) exists specifically to avoid this. **Mitigation**: the integration test in Step 2.6 explicitly asserts the real per-connection signal (`is*` guards on the resolved adapter, HTTP endpoint 200-vs-error behavior, and the `allegroCategoryAccessEnabled` config flag) differs between configured/unconfigured Erli connections, while confirming `connection.supportedCapabilities` itself stays unchanged across both (since it's static per-`adapterKey`, not per-instance); additionally, re-run the existing bulk-wizard test suite (`apps/web/src/features/listings/components/bulk/bulk-edit-modal.test.tsx`) unmodified after Phase 2 lands — it should still pass, proving no regression.
- **Sandbox/production category drift**: Allegro sandbox and production catalogs can differ. **Mitigation**: `allegroEnvironment` config field lets an operator match their Erli sandbox testing against Allegro sandbox categories; documented in the credentials panel's helper text.
- **Client-credentials token silently expiring mid-wizard-session**: a long-idle browser tab could hold a stale category list if the BE-side cache TTL (24h) outlives actual data changes upstream. **Mitigation**: pre-existing risk shared with Allegro's own category cache — not newly introduced, no additional mitigation needed beyond existing TTL.
- **Operator confusion about what the Allegro app credential is for**: mitigated by the approved mockup's explicit helper text ("Used only to read the public category catalog — never to sign in as a seller or place offers").

### Edge Cases
- Operator fills in `allegroClientId` but leaves `allegroClientSecret` blank (or vice versa) → client-side Zod validation blocks submit before hitting the API; server-side shape validator is the authoritative backstop (Step 2.3).
- Operator's Allegro app credentials are valid at save time but later revoked/rotated on Allegro's side → `AllegroCategoryCatalogClient.ensureToken()` throws on the next token request; surfaces as a 501-equivalent... actually as a thrown exception from `fetchCategories`/`fetchCategoryParameters`, which propagates up through `CategoriesCacheService`/`listings.controller.ts` as an unhandled error today for *other* adapters too (this is the general "adapter implements the capability but the call fails" case, not the "doesn't implement" case) — note this as a pre-existing gap in generic error handling, not something unique to introduce new handling for in this plan; flag as a possible fast-follow if it proves confusing in practice.
- Erli connection has Allegro credentials configured but the operator is mid-way through an in-progress offer draft created *before* the credentials were added → the wizard re-evaluates `connection.config.allegroCategoryAccessEnabled` on each mount (TanStack Query), so a page refresh picks up the new configuration; no special migration needed for in-flight drafts since nothing is persisted mid-wizard.

### Backward Compatibility
- ✅ Fully additive. Existing Erli connections without `allegroClientId`/`allegroClientSecret` behave identically to today (plain-text category ID field, no parameters step).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/integrations/erli/src/infrastructure/http/__tests__/allegro-category-catalog-client.spec.ts` (new) — token lifecycle + fetch mapping (Phase 1, Step 4).
- `libs/integrations/erli/src/application/__tests__/erli-adapter.factory.spec.ts` (extended) — with/without Allegro credentials branches.
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-offer-manager.adapter.spec.ts` (extended) — `isCategoryBrowser`/`isCategoryParametersReader` reflect constructor wiring correctly.
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-connection-credentials-shape-validator.adapter.spec.ts` (extended) — both-or-neither rule.
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-connection-config-shape-validator.adapter.spec.ts` (extended) — `allegroEnvironment` enum check.
- `apps/web/src/plugins/erli/components/erli-credentials-panel.test.tsx` (extended) — checkbox reveal, client-side both-or-neither validation, mutation payload shape.
- `apps/web/src/features/listings/components/erli/erli-create-offer-wizard.test.tsx` (extended) — capability-conditional rendering for category step, parameters step, stepper labels, `needsProductParameters` flag.

### Integration Tests
- `apps/api/test/integration/listings/erli-category-catalog.int-spec.ts` (new, Phase 2 Step 6) — end-to-end capability reflection through the real `GET /listings/connections/:id/categories/:categoryId/parameters` endpoint and the `allegroCategoryAccessEnabled` field in the connection-read response's `config`.

### Mocking Strategy
- `AllegroCategoryCatalogClient`'s unit tests mock global `fetch` directly (matches `AllegroTokenRefreshService.spec.ts`'s own approach — verify before writing, don't assume).
- The new integration test fakes at the **HTTP-client interface level** (per `docs/testing-guide.md`'s "Test-only HTTP-seam faking" pattern, #991) — a hand-rolled fake standing in for `AllegroCategoryCatalogClient`'s network calls, wired into the real `ErliOfferManagerAdapter`/`ErliAdapterFactory` so the adapter's own logic is genuinely exercised.
- FE tests use `renderWithProviders()` + `createMockApiClient()` per existing convention — no real network calls.

### Acceptance Criteria
- [ ] An Erli connection with valid Allegro app credentials has `allegroCategoryAccessEnabled: true` in its `config`, and its resolved adapter instance passes `isCategoryBrowser`/`isCategoryParametersReader`; a connection without has neither. (`connection.supportedCapabilities` itself is intentionally unaffected — it's static per-`adapterKey`, not a per-connection signal.)
- [ ] The Erli offer wizard renders the Allegro-style category tree + parameters steps when the capability is present, and today's plain-text field + fallback hint when absent.
- [ ] A required category parameter left empty blocks submit in the wizard (parity with Allegro).
- [ ] Submitted Erli offers with parameters filled via the wizard reach `ErliOfferManagerAdapter.buildExternalAttributes` unchanged (no BE regression — covered by existing tests, re-run not rewritten).
- [ ] The #1367 bulk-wizard test suite passes unmodified.
- [ ] `pnpm lint && pnpm type-check && pnpm test` green across `libs/integrations/erli`, `apps/api`, `apps/web`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no CORE changes; ADR-031 explicitly avoids a new cross-plugin dependency)
- [x] Uses existing patterns (no unnecessary abstractions — reuses `CategoryPicker`, `useCategoryParametersQuery`, `CategoriesCacheService`, `OfferBuilderService` merge logic verbatim)
- [x] Idempotency considered (token acquisition is naturally idempotent/re-entrant; no write-side idempotency concerns — this feature is read-only against Allegro)
- [ ] Event-driven patterns — not applicable (no new domain events)
- [x] Rate limits & retries addressed (relies on existing `CategoriesCacheService` 24h cache to minimize Allegro API calls; no new retry logic needed beyond existing `ErliNetworkException` conventions)
- [x] Error handling comprehensive (Phase 2 Step 5 explicitly verifies no new error paths are introduced at existing call sites)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [ADR-031](../architecture/adrs/031-erli-allegro-category-catalog-via-client-credentials.md) — architectural decision for this plan
- [ADR-023](../architecture/adrs/023-cross-platform-category-and-attribute-projection.md) — cross-platform category placement and attribute projection
- [ADR-025](../architecture/adrs/025-erli-marketplace-adapter.md) — Erli marketplace adapter design
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
