# Implementation Plan — #383: Allegro `fetchSellerPolicies` uses wrong delivery endpoint

**Issue:** [#383](https://github.com/SilkSoftwareHouse/openlinker/issues/383)
**Branch:** `383-allegro-seller-policies-delivery-endpoint`
**Type:** Bug fix (integration adapter)
**Layer:** Infrastructure adapter (`libs/integrations/allegro/`)

---

## Phase 1 — Understand the Task

### Goal

`GET /listings/connections/:connectionId/seller-policies` returns an empty `deliveryPolicies` array for every Allegro connection, regardless of how many delivery methods the seller has configured. This starves the "Delivery" dropdown in `CreateOfferWizard` and effectively blocks offer creation on Allegro.

Root cause (already diagnosed in the issue): `AllegroOfferManagerAdapter.fetchSellerPolicies` calls `GET /sale/delivery-settings`, whose real response is **a single object** describing account-level delivery config (`marketplace`, `freeDelivery`, `joinPolicy`, …) — **not** a list. The code (and a fabricated TypeScript type) assume a `deliverySettings: []` key that does not exist on the response, so `(delivery.data.deliverySettings ?? []).map(...)` always falls back to `[]`.

The correct endpoint is `GET /sale/shipping-rates`, which returns `shippingRates: [{ id, name, features, marketplaces }]`. Its `id` values are the same namespace that `POST /sale/product-offers` already expects at `delivery.shippingRates.id` — which is what the adapter is already submitting when creating offers (line 760). So the fix makes the full round-trip internally consistent.

### Classification

- **Layer:** Infrastructure adapter — `libs/integrations/allegro/`
- **Boundary impact:** None. The `SellerPoliciesReader` capability contract (`fetchSellerPolicies(): Promise<SellerPolicies>`) and the `SellerPolicies` domain type are unchanged. Only the adapter's internal implementation and its private TypeScript type for the HTTP response change.
- **Blast radius:** Allegro connections only. No schema changes, no FE changes, no API surface changes, no migration.

### Explicit non-goals

Deferred to separate issues (called out in the #383 "Out of scope" section):

1. Mapping `features.managedByAllegro` / `features.isFulfillment` / `marketplaces[]` into the returned `SellerPolicy`.
2. Per-marketplace filtering (`/sale/shipping-rates?marketplace=allegro-pl`).
3. Exposing `/sale/delivery-settings` (the account-level free-delivery / joinPolicy config) as a separate resource elsewhere — it is a legitimate but different concept and not relevant to the "pick a delivery policy" dropdown.
4. Re-examining the 10-minute `SellerPoliciesService` cache strategy.
5. Any changes to the cache key or manual cache-clear endpoint.

---

## Phase 2 — Research the Codebase

### Verified facts

1. **Adapter call site** — `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts:680-697`:
   ```ts
   const [delivery, returns, warranties, impliedWarranties] = await Promise.all([
     this.httpClient.get<AllegroDeliverySettingsResponse>('/sale/delivery-settings'),
     this.httpClient.get<AllegroReturnPoliciesResponse>('/after-sales-service-conditions/return-policies'),
     this.httpClient.get<AllegroWarrantiesResponse>('/after-sales-service-conditions/warranties'),
     this.httpClient.get<AllegroImpliedWarrantiesResponse>('/after-sales-service-conditions/implied-warranties'),
   ]);

   return {
     deliveryPolicies: (delivery.data.deliverySettings ?? []).map(mapEntry),
     // ...
   };
   ```

2. **Type definition** — `libs/integrations/allegro/src/domain/types/allegro-api.types.ts:363-375`:
   ```ts
   export interface AllegroSellerPolicyEntry { id: string; name: string; }
   export interface AllegroDeliverySettingsResponse { deliverySettings: AllegroSellerPolicyEntry[]; }
   ```
   (Co-located with `AllegroReturnPoliciesResponse`, `AllegroWarrantiesResponse`, `AllegroImpliedWarrantiesResponse`.)

3. **Public API surface** (unchanged by this fix):
   - Capability: `libs/core/src/listings/domain/ports/capabilities/seller-policies-reader.capability.ts`
   - Domain type: `libs/core/src/listings/domain/types/seller-policies.types.ts` — `SellerPolicies { deliveryPolicies, returnPolicies, warranties, impliedWarranties }`
   - Controller: `apps/api/src/listings/http/listings.controller.ts:241-257` (passthrough)
   - Application service: `libs/core/src/listings/application/services/seller-policies.service.ts` (10-min cache)
   - FE hook: `apps/web/src/features/listings/hooks/use-seller-policies-query.ts`
   - FE consumer: `apps/web/src/features/listings/components/CreateOfferWizard.tsx:598-607`

4. **Adapter already submits shipping-rates IDs** — `allegro-offer-manager.adapter.ts:755-761` builds `body.delivery.shippingRates = { id: deliveryPolicyId }` when creating offers. So swapping the fetch endpoint aligns both sides of the round-trip without any payload changes.

5. **Existing test coverage** — `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts`:
   - The `fetchSellerPolicies` describe block contains **three** tests (verified in pre-flight):
     - Happy path (lines 777–825): mocks `{ deliverySettings: [...] }` plus the three other policies. **Already asserts on `calledPaths`** (lines 816–824) — which means the bug is pinned to the wrong URL by the current test. Flipping the URL string flips both the mock and the assertion.
     - Empty case (lines 827–842): mocks `{ deliverySettings: [] }` + empty others; asserts output shape is all-empty arrays.
     - Error case (lines 844–852): mocks `{ deliverySettings: [] }`, then rejects the second GET with `AllegroApiException`; asserts the error propagates.
   - All three tests reference `deliverySettings` as the response field; the happy-path test also references `/sale/delivery-settings` as the expected URL. All need realignment.

6. **Type usage / barrel exports** — verified via `grep -r AllegroDeliverySettingsResponse libs apps`: the type is referenced only in the type file (definition) and the adapter (import + usage). **No barrel re-export.** Rename is safe — no external-consumer breakage.

7. **`SellerPoliciesService` cache** — verified: DB-backed via `SellerPoliciesCacheRepositoryPort` (`libs/core/src/listings/application/services/seller-policies.service.ts:37-38`), **not in-memory**. TTL is 10 minutes (`SELLER_POLICIES_TTL_MS = 10 * 60 * 1000`) gated on `fetchedAt`. Impact on this fix: connections with a recently-cached empty-delivery response will see stale empty lists for up to 10 minutes after deploy. Acceptable (short TTL, self-heals), but **must be noted in PR body**.

6. **Allegro OpenAPI spec** (`https://developer.allegro.pl/swagger.yaml`):
   - `/sale/shipping-rates` → `GET` returns `{ shippingRates: [{ id, name, features: { managedByAllegro, isFulfillment }, marketplaces: [{ id }] }] }`. OAuth scope unspecified in the security block in the spec but return-policy / warranty endpoints in the same family require `allegro:api:sale:settings:read`, which Allegro's tutorial page documents as the correct scope for shipping rates too. The existing connection already has the scope granted (otherwise return / warranty fetches would 403).
   - `/sale/delivery-settings` → `GET` returns a single `DeliverySettingsResponse` object with `marketplace`, `freeDelivery`, `abroadFreeDelivery`, `joinPolicy`, `customCost`. No array field. Requires `allegro:api:sale:settings:read`.

### Similar patterns to follow

- The other three policy-family endpoints in the same method (`return-policies`, `warranties`, `implied-warranties`) each return `{ <policyName>: AllegroSellerPolicyEntry[] }`. After the fix, `/sale/shipping-rates` will follow the exact same shape (`{ shippingRates: [...] }`). No structural divergence.

---

## Phase 3 — Design the Solution

### Approach

Three surgical edits. Nothing else. The fix is small and contained.

1. **Swap the URL** in `allegro-offer-manager.adapter.ts` from `/sale/delivery-settings` to `/sale/shipping-rates`.
2. **Rename the response type** `AllegroDeliverySettingsResponse` → `AllegroShippingRatesResponse` in `allegro-api.types.ts` and change the key `deliverySettings` → `shippingRates`.
3. **Update the response-field access** in the adapter (`delivery.data.deliverySettings` → `delivery.data.shippingRates`).
4. **Update the test mock** to match the new URL + response shape and **add a regression test** that asserts the HTTP client is invoked with `/sale/shipping-rates` (locks in endpoint choice).

### Why not keep the old name

`AllegroDeliverySettingsResponse` is a private interface inside `libs/integrations/allegro/src/domain/types/`. Renaming it costs nothing and avoids future confusion — the `/sale/delivery-settings` endpoint is a real Allegro resource and we do not want a type named after it that is actually modelling `/sale/shipping-rates`.

### Data flow (unchanged)

```
FE CreateOfferWizard
  → GET /listings/connections/:id/seller-policies
  → ListingsController.getSellerPolicies
  → SellerPoliciesService.getSellerPolicies (cached 10min)
  → AllegroOfferManagerAdapter.fetchSellerPolicies
    → Promise.all([
        GET /sale/shipping-rates,                                 ← CHANGED (was /sale/delivery-settings)
        GET /after-sales-service-conditions/return-policies,
        GET /after-sales-service-conditions/warranties,
        GET /after-sales-service-conditions/implied-warranties,
      ])
    → map each [{id,name}] into SellerPolicy entries
  ← SellerPolicies { deliveryPolicies, returnPolicies, warranties, impliedWarranties }
```

---

## Phase 4 — Step-by-Step Implementation Plan

### Step 1 — Rename the HTTP response type

**File:** `libs/integrations/allegro/src/domain/types/allegro-api.types.ts`

- Rename `AllegroDeliverySettingsResponse` → `AllegroShippingRatesResponse`.
- Rename property `deliverySettings: AllegroSellerPolicyEntry[]` → `shippingRates: AllegroSellerPolicyEntry[]`.
- Update the inline JSDoc comment above it (it currently says "from `/sale/delivery-settings`") to reference `/sale/shipping-rates`.
- No other type changes: `AllegroSellerPolicyEntry` is reused as-is.

**Acceptance:** Type compiles; importers (adapter + test) need to update their usage.

### Step 2 — Update the adapter

**File:** `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts`

- Change the import from `AllegroDeliverySettingsResponse` to `AllegroShippingRatesResponse`.
- On the `fetchSellerPolicies` Promise.all:
  - URL `'/sale/delivery-settings'` → `'/sale/shipping-rates'`.
  - Type argument `AllegroDeliverySettingsResponse` → `AllegroShippingRatesResponse`.
- In the returned object: `delivery.data.deliverySettings` → `delivery.data.shippingRates`.
- Update the `@remarks` / doc comment above the method so it says "delivery (shipping-rates) + return + warranty + implied-warranty" to reflect the correct endpoint name.

**Acceptance:** Adapter calls `/sale/shipping-rates` and reads the `shippingRates` field. No other behavior changes.

### Step 3 — Realign all three existing test mocks

**File:** `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts`

Three test cases inside `describe('fetchSellerPolicies', …)` need updating (see Phase 2 §5):

1. **Happy path (777–825):**
   - Mock response `{ deliverySettings: [...] }` → `{ shippingRates: [...] }`.
   - URL in `calledPaths` assertion (line 822): `/sale/delivery-settings` → `/sale/shipping-rates`.
   - Output-shape assertions on `deliveryPolicies` stay as-is.
2. **Empty case (827–842):** `makeResponse({ deliverySettings: [] })` → `makeResponse({ shippingRates: [] })`.
3. **Error case (844–852):** same field rename on the first mock.

**Acceptance:** All three tests pass against the new adapter. The happy-path `calledPaths` assertion now pins the adapter to `/sale/shipping-rates` — effectively the regression guard, since the previous test *pinned the bug*.

### Step 4 — Add a defensive negative assertion

**File:** same as Step 3.

Rather than a separate new test (duplicative with the happy-path URL assertion), add one line to the happy-path test:

```ts
expect(calledPaths).not.toContain('/sale/delivery-settings');
```

**Rationale:** A future dev who reintroduces the old URL will have to edit this assertion away — the mistake becomes visible in review. Keeps test surface area minimal.

### Step 5 — Quality gate

Run from the repo root:

```bash
pnpm lint
pnpm type-check
pnpm test
```

All three must pass with zero errors. Fix root causes of any failures — do not work around.

### Step 6 — Self-review

Checklist from `docs/code-review-guide.md`:

- [ ] Naming: type rename cleanly (no stragglers referencing `AllegroDeliverySettingsResponse`).
- [ ] No other file imports the old type name. `grep -r AllegroDeliverySettingsResponse libs apps` returns 0 hits.
- [ ] No `any`, no `console.log`, no hardcoded values.
- [ ] Adapter doc comment updated to match the new endpoint.
- [ ] No changes to the public capability contract (`SellerPoliciesReader` interface).
- [ ] No changes to the domain `SellerPolicies` type.
- [ ] No changes to the application service, controller, DTO, or FE.
- [ ] Tests cover: existing mapping behavior (unchanged), new endpoint assertion (new).

### Step 7 — Commit, push, open PR

- Branch: `383-allegro-seller-policies-delivery-endpoint` (already set).
- Conventional commit scope `fix(allegro):` per `main` convention (verified in pre-flight: `dd3cf59 fix(allegro): drain error.cause ...`):
  ```
  fix(allegro): use /sale/shipping-rates for seller delivery policies

  Closes #383
  ```
- PR body must note:
  - Swagger-verified root cause (`/sale/delivery-settings` returns a single object, not a list).
  - Cache side-effect: connections with a recent `seller_policies_cache` row will see stale empty delivery lists for up to 10 minutes after deploy (self-heals on TTL expiry).
  - Residual scope risk: `/sale/shipping-rates` OAuth scope not explicitly documented in the swagger security block — rely on the empirical fact that return/warranty endpoints (same scope family) already work on existing connections.

---

## Phase 5 — Validation

### Architecture compliance

- ✅ Change is fully contained to `libs/integrations/allegro/` (one adapter file, one types file, one spec file).
- ✅ No changes to core (`libs/core/src/listings/`), API (`apps/api/`), or FE (`apps/web/`).
- ✅ The `SellerPoliciesReader` capability contract (`fetchSellerPolicies(): Promise<SellerPolicies>`) is unchanged.
- ✅ `SellerPolicies` domain type (`libs/core/src/listings/domain/types/seller-policies.types.ts`) is unchanged.
- ✅ No new ports, no new services, no new DI wiring.
- ✅ Adapter-internal HTTP response type is private to the allegro integration package.

### Naming

- ✅ Renamed `AllegroDeliverySettingsResponse` → `AllegroShippingRatesResponse` — matches the endpoint name (`/sale/shipping-rates`) and the response's top-level field (`shippingRates`).
- ✅ `AllegroSellerPolicyEntry` stays — it is a generic `{id, name}` shape used by all four policy endpoints.

### Testing strategy

- **Unit test update:** existing happy-path test's mock is realigned to the real endpoint.
- **New regression test:** asserts the adapter calls the correct URL. This is the first test in this spec that pins the URL — a deliberate addition to prevent silent regressions.
- **Integration tests:** none needed. The adapter has no DB touchpoint; the bug is purely in the outbound HTTP URL + response parsing.
- **Manual verification:** call `/listings/connections/:connectionId/seller-policies` against a real Allegro connection with delivery methods configured (issue reporter already identified connection `34465b3a-9ef3-41bd-b1ed-6c859adcfd65`). Expect non-empty `deliveryPolicies`. Not blocking for PR — this is a post-merge smoke check, flagged in AC of the issue.

### Security

- No secret handling. No new credentials. No new env vars.
- The OAuth scope required by `/sale/shipping-rates` (`allegro:api:sale:settings:read`) is the same one required by the return-policy / warranty endpoints that already work on existing connections — so no re-auth needed.
- No user input is interpolated into the URL (the path is a literal string).

### Performance

- Same number of HTTP calls as before (4, in parallel).
- Same cache behavior (10-minute `SellerPoliciesService` cache). Cached empty arrays from before the deploy will expire naturally within 10 minutes; no cache bust required.

### Risk

- **Low.** The fix is 3 substantive edits, well-scoped, and backed by the Allegro OpenAPI spec.
- **Failure mode if the endpoint is also wrong:** offer creation via the wizard stays broken; no new regressions are introduced because delivery IDs were already expected to be shipping-rates IDs by the `POST /sale/product-offers` body construction. Worst case, we learn something new and file a follow-up.
- **Cache staleness:** operators hitting the page right after deploy may see stale empty results for up to 10 minutes. Acceptable. A manual cache-clear is not warranted for a cache that short.

---

## Open questions

None. The issue diagnosis, swagger verification, and offer-creation round-trip cross-check all align. Proceed to implementation.
