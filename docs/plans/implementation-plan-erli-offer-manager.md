# Implementation Plan: ErliOfferManager — single-PATCH product resource (#984)

**Date**: 2026-06-15
**Status**: Draft / Ready for Review (rev. 2 — post plan-review)
**Estimated Effort**: M (downgraded from L: once category/variants/stock/reconciliation are excluded, the surface is 3 methods + classifiers + wiring on an already-built #981/#982 base)
**Branch**: `984-erli-offer-manager` (stacked on `982-erli-connection-auth-validators-tester`)
**Issue**: #984 · **Spec**: #978 (User story 2 "List") · **ADR**: ADR-025 (governs; no new ADR)

> **Revision note (rev. 2).** Three plan reviews (general / tech-lead / security) verified against the live codebase produced two BLOCKING corrections + several refinements, all folded in here:
> - **202 maps to `'draft'`, NOT `'validating'`** — `'validating'` schedules a status poll (`offer-creation-execution.service.ts:154`) that requires `OfferStatusReader` (deferred to #989); without it the poll flips the record to `failed`/`OFFER_POLL_NOT_SUPPORTED` (`offer-status-poll.service.ts:131-139`), turning every successful Erli create into a `business_failure`. `'draft'` → `recordToOutcome` = `'ok'` and schedules no poll (`offer-creation-execution.service.ts:216,228`). #989 flips `'draft'`→`'validating'` when it lands `OfferStatusReader`.
> - **Classifier registration is in #984's scope** — the #981 Erli exception docblocks + barrel say "#984 registers RetryClassifier/AuthFailureClassifier". Added to `register(host)`.
> - Plus: `encodeURIComponent` + allowlist on the seller-keyed id (security), safe `OfferCreateRejectedException` mapping (no `responseBody` leak), Allegro-mirrored `createAdapters` signature, `POST {idempotent:true}`, price/description normalization helpers, pinned `erli-plugin.spec.ts` edits.

---

## 1. Task Summary

**Objective**: Add `ErliOfferManagerAdapter` implementing `OfferManagerPort` + the `OfferCreator` and `OfferFieldUpdater` sub-capabilities, all collapsing onto Erli's single seller-keyed **product** resource:

- `OfferCreator.createOffer` → `POST /products/{externalId}`
- `OfferFieldUpdater.updateOfferFields` → sparse `PATCH /products/{externalId}`
- `OfferManagerPort.updateOfferQuantity` → sparse `PATCH /products/{externalId}`

Wire the capability into the plugin (manifest + `createCapabilityAdapter` dispatch + factory) and register the Erli retry / auth-failure classifiers. Honour Erli's **async write model** (HTTP 202 = *submitted*, ~20-min cache lag, no read-after-write) per ADR-025's reconciliation-first posture.

**Classification**: Integration (plugin) only. No CORE change, no migration, no interface/API change.

---

## 2. Scope & Non-Goals

### In scope
- `ErliOfferManagerAdapter` (`implements OfferManagerPort, OfferCreator, OfferFieldUpdater`).
- Mapping the **basic product fields the neutral commands already carry**: name/title, price, stock, description, images, barcode (EAN/GTIN). Provisional Erli product **wire types** (#992).
- Sparse-PATCH semantics for field + quantity updates (body carries only supplied fields).
- 202/async handling: 2xx → `CreateOfferResult.status = 'draft'` ("submitted, not yet confirmed") — never a false failure, never schedules the #989 poll.
- **Seller-keyed id resolution** with `encodeURIComponent` + format allowlist (`resolveErliProductId`).
- Per-connection construction via `ErliAdapterFactory.createAdapters(connection, identifierMapping, credentialsResolver)` + plugin dispatch (`OfferManager`) + manifest `supportedCapabilities: ['OfferManager']`.
- **Classifier registration** in `register(host)`: `ErliRetryClassifierAdapter` (4xx/auth = non-retryable) + `ErliAuthFailureClassifierAdapter` (401/403 = credential-rejected → `needs_reauth`, ADR-008). The #981 exception docblocks assign these to #984.
- Error mapping: Erli `4xx` on create → `OfferCreateRejectedException(adapterKey, statusCode, errors[])` with **safe** message construction (no raw `responseBody` leak); field/quantity update lets the typed `Erli*Exception` propagate (mirrors Allegro).
- Unit tests (adapter + factory + plugin dispatch + classifiers + hostile-id + error-message-safety).

### Out of scope (own issues — leave clearly-marked seams, do not block)
- **Category / parameter payload** (Allegro-ID reuse, `source:"allegro"`) → **#985**.
- **Multi-variant grouping** (`externalVariantGroup`) → **#986**.
- **Stock/price sourcing from master inventory** + **frozen-field exclusion** → **#988**. (#984 *sends* the price/stock the command carries; it does not source them from master, nor exclude frozen fields.)
- **Offer-status reconciliation snapshot** + the `OfferStatusReader` capability + the `'draft'`→`'validating'` flip → **#989**.
- **Stock-restore-on-cancel** compensation (ADR-025 §4a) → orders half.
- Integration tests → **#991**.

### Constraints
- Stacked on #982 (uses its `ErliAdapterFactory` + `ErliHttpClient` + `Erli*Exception`s). Draft PR targeting `main` until the stack merges.
- Exact Erli product-resource JSON field names are **deferred to the #992 sandbox spike** (spec R3). All field-name guesses isolated in `erli-product.types.ts`; the id format and the error-body shape are isolated in `resolveErliProductId` and the create-error mapper respectively, so #992 reconciles a known short list.

---

## 3. Architecture Mapping

**Target layer**: Integration — `libs/integrations/erli/`.

**Capabilities involved** (from `@openlinker/core/listings`, top-level barrel — verified present):
- `OfferManagerPort` (`updateOfferQuantity(UpdateOfferQuantityCommand): Promise<void>`).
- `OfferCreator` + `isOfferCreator` (`createOffer(CreateOfferCommand): Promise<CreateOfferResult>`).
- `OfferFieldUpdater` + `isOfferFieldUpdater` (`updateOfferFields(UpdateOfferFieldsCommand): Promise<void>`).
- `OfferCreateRejectedException` (ctor `(adapterKey: string, statusCode: number, errors: CreateOfferValidationError[])`), `CreateOfferResult`, `CreateOfferResultStatusValues = ['draft','validating','active']`, `CreateOfferValidationError`.

**Host-side**: `ErliIntegrationModule` is already in `apps/api/src/plugins.ts` + `apps/worker/src/plugins.ts`, and `jest-integration.cjs` already source-maps `@openlinker/integrations-erli` → flipping `supportedCapabilities` to `['OfferManager']` needs **no host-side change**.

**Existing components reused**:
- `ErliHttpClient` / `IErliHttpClient` (#981) — `post`/`patch`, retry, origin-pinned URL build, typed exceptions. `ErliRequestOptions.idempotent` opts a POST into retry-safety.
- `ErliAdapterFactory` (#982) — `resolveCredentials`/`resolveBaseUrl`/`createHttpClient`; extended with `createAdapters()`.
- `dispatchCapability` (`@openlinker/plugin-sdk`).
- `ErliApiException` / `ErliAuthenticationException` / `ErliNetworkException` / `ErliRateLimitException` / `ErliConfigException` (#981) — the classifiers consume these.
- `RetryClassifierRegistryService` + `AuthFailureClassifierRegistryService` (on `HostServices`); the `RetryClassifierPort` / `AuthFailureClassifierPort` contracts from core.

**New components**:
- `infrastructure/adapters/erli-offer-manager.adapter.ts` — `ErliOfferManagerAdapter`.
- `infrastructure/adapters/erli-product.types.ts` — provisional Erli product wire types + the create/patch payload builders' shapes. **Correct location: `infrastructure/adapters/`** — unlike #982's connection types (which the *application*-layer factory reads), these wire types are consumed only by the adapter (same layer); the factory never imports them, so there is no application→infrastructure inversion.
- `infrastructure/adapters/erli-retry-classifier.adapter.ts` + `erli-auth-failure-classifier.adapter.ts` — small classifiers over the typed exceptions.
- `ErliAdapters` type + `ErliAdapterFactory.createAdapters()`.

**Core vs Integration justification**: Pure Integration. CORE ports/commands already exist; #984 only adds an Erli adapter + classifiers. CORE untouched.

**Reference precedent**: `AllegroOfferManagerAdapter`, `AllegroAdapterFactory.createAdapters(connection, identifierMapping, credentialsResolver)`, `allegro-plugin.ts` dispatch + classifier registration. Erli mirrors the *structure* but is far smaller and async-202.

---

## 4. Design

### 4.1 Seller-keyed external id (`resolveErliProductId`)

Erli's product resource is addressed by a **caller-assigned** id (`POST /products/{externalId}`). So:
- `createOffer(cmd)` derives the Erli id from `cmd.internalVariantId` (stable OL variant id) — deterministic, making the POST **upsert-like and retry-safe**.
- `CreateOfferResult.externalOfferId` returns that same id; later `updateOfferFields(externalOfferId)` / `updateOfferQuantity(offerId)` receive it directly and PATCH it.

**Namespace scoping (documented assumption)**: the Erli product-id namespace is **per-seller-account** (one API key = one seller panel; the client closes over one connection's key). `internalVariantId` is globally unique per OL variant, so it is a collision-safe natural key within any one Erli account. Re-listing the same variant to the same account upserts (intended); listing to a different account is a different namespace.

**Security — id is interpolated into the URL path, so it MUST be encoded + validated** (security review, MEDIUM). The #981 client's origin-pin blocks cross-host retargeting + scheme downgrade but does **not** block same-origin `../` path traversal or `?`/`#` injection from a hostile id segment. `resolveErliProductId`:
1. validates the raw id against an allowlist (`^ol_variant_[a-f0-9]{32}$` while it's the variant id) and throws `ErliConfigException` otherwise (fail closed), and
2. `encodeURIComponent`s the id before interpolating into `productPath(id)`.

> **Security invariant (must hold across any Q2 allowlist change)**: whatever charset the id allowlist admits, it MUST exclude `/`, `?`, `#`, and any `..` sequence — and `encodeURIComponent` stays as the backstop even if the regex widens. A future edit relaxing the allowlist for a SKU charset must re-assert this, not just "adjust the regex".
>
> **#992 confirmation (Q2)**: whether Erli requires a SKU/barcode-format id instead of the raw variant id. If so, the allowlist + encoding stay; the *derivation* changes inside this one helper — and if the new id is no longer reconstructible from `internalVariantId` alone, the `identifierMapping` row (written by `OfferCreationExecutionService`, see §4.4) becomes the recovery path, which is why we keep `identifierMapping` in the factory signature now.

### 4.2 Async 202 → status mapping (`'draft'`, not `'validating'`)

`ErliHttpClient` treats 202 as a successful `{ status: 202, data }`.

| Erli response | `CreateOfferResult.status` | Rationale |
|---|---|---|
| 2xx (incl. 202 accepted) | **`'draft'`** | Submitted, not yet confirmed. `'draft'` → `recordToOutcome` = `'ok'` and **does not schedule the #989 status poll**. ADR-025 forbids treating 202 as *confirmation* (`'active'`); `'draft'` is the honest "created, awaiting confirmation" state when the adapter cannot read status back. **#989** introduces `OfferStatusReader` and flips this to `'validating'` in the same PR, so the poll seam activates only when something can answer it. |
| 4xx with errors | throw `OfferCreateRejectedException('erli.shopapi.v1', statusCode, errors[])` | Deterministic rejection → `OfferCreationExecutionService` records `business_failure`. |
| 401/403 | `ErliAuthenticationException` propagates → auth-failure classifier → `needs_reauth` | Now actually wired (§4.4 classifiers). |

> `publishImmediately` does not change this in #984 — both draft and live submissions return `'draft'` until #989 can read the real publication status. (Noted as a #989 refinement.)

### 4.3 Field mapping (#984-owned fields only)

Two small builders in `erli-product.types.ts` (or a co-located mapper), each emitting only the keys it's given:

- **`buildCreateProductPayload(cmd)`**: `name` ← `cmd.overrides?.title`; `price` ← `cmd.price` (`{amount:number, currency}`); `stock` ← `cmd.stock`; `description` ← `cmd.overrides?.description` (plain string); `images` ← `cmd.overrides?.imageUrls`; `barcode` ← `cmd.variantBarcode`. **Category/parameters (#985), variant group (#986)** → a single commented insertion seam, not assembled here.
- **`buildPatchPayload(fields | quantity)`**: sparse — `updateOfferFields` reads `fields.price`/`fields.title`/`fields.description` (the neutral field names) and emits only the supplied keys onto the Erli product (the Erli wire key for title may be `name` — confirmed in `erli-product.types.ts` / #992); `updateOfferQuantity` emits `{ stock: cmd.quantity }` only.

**Normalization helpers (review)**:
- **Price**: `CreateOfferCommand.price.amount` is `number`, `OfferFieldUpdate.price.amount` is `string` — a single `toErliPrice(amount: number | string, currency)` normalizes both into the one provisional Erli price shape.
- **Description**: create sources a plain `string`; update sources the structured `OfferDescriptionUpdate.sections[].items[]` (TEXT). A single `flattenDescription(input: string | OfferDescriptionUpdate): <erli desc field>` collapses both so create/update serialize description identically (mirrors Allegro's `extractOfferDescription`). One #992 reconciliation site, not two.
- **`imageUrls`** (security, LOW — **hard AC, not deferred**): validate each entry is an `https://` absolute URL before forwarding and reject non-http(s) + obviously-internal hosts (localhost / `127.0.0.0/8` / RFC-1918 / `.internal`). Honest framing: this is best-effort input hygiene so OL isn't a trivial SSRF conduit for an Erli-side image fetcher — it does NOT defeat DNS-rebinding or public-hostname-resolves-internal; true egress control is network-layer and out of scope (the actual fetcher is Erli, not OL). Land the check in this PR; do not forward unvalidated.

> Frozen-field exclusion (#988) is NOT applied here — sparse PATCH is the precondition #988 builds on.

### 4.4 Wiring

1. `erliAdapterManifest.supportedCapabilities` → `['OfferManager']` (was `[]`).
2. **`ErliAdapterFactory.createAdapters(connection, identifierMapping, credentialsResolver)`** → `Promise<ErliAdapters>` where `ErliAdapters = { offerManager: OfferManagerPort & OfferCreator & OfferFieldUpdater }`. **Mirror Allegro's 3-arg signature** even though `identifierMapping` is unused in #984 — documented in the factory — so #985/#986/#988 extend behaviour without churning the factory signature or the plugin call site. Builds the client (default retry) + constructs the adapter.
3. `erli-plugin.ts createCapabilityAdapter` → `new ErliAdapterFactory()`, `await factory.createAdapters(connection, host.identifierMapping, host.credentialsResolver)`, then `dispatchCapability<T>(capability, { OfferManager: () => adapters.offerManager }, ERLI_BRAND)`.
4. **`register(host)`** (extend #982's) — register the two classifiers at `erli.shopapi.v1`:
   - `host.retryClassifierRegistry.register(adapterKey, new ErliRetryClassifierAdapter())` — `ErliApiException` (deterministic 4xx) + `ErliAuthenticationException` → non-retryable; `ErliNetworkException`/`ErliRateLimitException` → retryable.
   - `host.authFailureClassifierRegistry.register(adapterKey, new ErliAuthFailureClassifierAdapter())` — `ErliAuthenticationException` → credential-rejected (→ `needs_reauth`).
   - Note: the runner dispatches these classifiers **OR-across-all** (it holds the raw error, not an `adapterKey`), so the `adapterKey` passed to `.register()` is a bookkeeping label, not a routing key. Safe because Erli and Allegro exception classes are disjoint (each classifier only recognises its own platform's exception types).
5. **`createOffer` POST passes `{ idempotent: true }`** to `httpClient.post` so the deterministic-id create is retry-safe (the #981 client defaults POST to fail-fast/non-idempotent).

> `cmd.idempotencyKey` is **not** a header the Erli client sends; dedup rests on the deterministic seller-keyed id + `idempotent:true`. The plan does not claim otherwise (the key may be logged for traceability only).

### 4.5 Files

| Path | Action |
|---|---|
| `infrastructure/adapters/erli-product.types.ts` | NEW — provisional wire types (`ErliProductCreateBody`, `ErliProductPatchBody`) + builders/normalizers, marked #992-provisional. |
| `infrastructure/adapters/erli-offer-manager.adapter.ts` | NEW — `ErliOfferManagerAdapter`. |
| `infrastructure/adapters/erli-retry-classifier.adapter.ts` | NEW — `ErliRetryClassifierAdapter implements RetryClassifierPort`. |
| `infrastructure/adapters/erli-auth-failure-classifier.adapter.ts` | NEW — `ErliAuthFailureClassifierAdapter implements AuthFailureClassifierPort`. |
| `application/erli-adapter.factory.ts` | EDIT — add `ErliAdapters` + `createAdapters(connection, identifierMapping, credentialsResolver)`. |
| `erli-plugin.ts` | EDIT — manifest capability; dispatch table; classifier registration in `register`. |
| `__tests__/` (specs) | NEW/EDIT — adapter, factory, classifiers, plugin dispatch (+ existing `erli-plugin.spec.ts` edits, §6 step 7). |

`index.ts` barrel: no change (adapter/classifiers stay package-private; manifest/module already public).

---

## 5. Questions & Assumptions

### Open questions (→ #992 sandbox spike)
- **Q1** Exact Erli product JSON field names + whether `ean`/`gtin` is top-level or nested under category parameters. Isolated in `erli-product.types.ts`.
- **Q2** Is the raw `internalVariantId` an acceptable `{externalId}`, or must it be a SKU/barcode (different charset → adjust `resolveErliProductId` allowlist + derivation; may then require the `identifierMapping` row to recover the id).
- **Q3** Does Erli return a body on 202 or empty? (Adapter tolerates `ErliHttpResponse.data === undefined`.)
- **Q4** Erli error-response body shape — drives whether `OfferCreateRejectedException.errors[]` carries parsed field-level errors or a single generic one. Isolated in the create-error mapper.
- **Q5** Tester probe path (`/offers?limit=1`, #982) vs product path (`/products/{id}`, #984) — #992 must reconcile **both** placeholders together.

### Assumptions (safe defaults)
- **A1** Deterministic seller-keyed id + `POST {idempotent:true}` → retry-safe upsert.
- **A2** 202 → `'draft'` (no poll); #989 flips to `'validating'` with `OfferStatusReader`.
- **A3** `updateOfferQuantity`/`updateOfferFields` → `void` on any 2xx; typed exceptions propagate on 4xx/5xx.
- **A4** Both description input shapes collapse through one `flattenDescription` helper.

### Documentation gaps
- Erli product/error schema not in spec (R3 → sandbox). Mitigated by isolating names in one file + HTTP-mocked unit tests asserting *mapping behaviour* (which keys present/absent), not live acceptance.

---

## 6. Proposed Implementation Plan

### Phase 1 — Wire types + id resolver
1. **`erli-product.types.ts`** — `ErliProductCreateBody` + `ErliProductPatchBody` (all-optional on patch) + `toErliPrice` + `flattenDescription`; header NOTE: field names provisional (#992), single reconciliation point. **Acceptance**: type-check clean; no field-name guesses leak outside this file.
2. **`resolveErliProductId(cmd)` + `productPath(id)`** (in the adapter) — allowlist-validate (`^ol_variant_[a-f0-9]{32}$`) → throw `ErliConfigException` on miss; `encodeURIComponent` before interpolation. **Acceptance**: unit test — hostile ids (`../admin`, `a/b`, `a?x=1`, non-matching) rejected or encoded; valid id → `products/<encoded>`.

### Phase 2 — Adapter
3. **`updateOfferQuantity`** → `patch(productPath(offerId), buildPatchPayload({stock}))`; void on 2xx. **Acceptance**: body has only `stock`; 202 resolves.
4. **`updateOfferFields`** → sparse patch (price/name/description via normalizers). **Acceptance**: omitted fields absent; 202 resolves.
5. **`createOffer`** → `buildCreateProductPayload`; `post(productPath(id), body, { idempotent: true })`; 2xx → `{ externalOfferId: id, status: 'draft' }`; `ErliApiException` (4xx) → **safe** `OfferCreateRejectedException('erli.shopapi.v1', statusCode ?? 0, errors)` where `errors` = parsed structured errors **or** a single `{ code:'ERLI_REJECTED', message:'Erli rejected the offer (HTTP <status>).' }` — **never** the raw `responseBody` (kept to `logger.debug` only). **Acceptance**: 202 → `status:'draft'` + correct externalOfferId; 4xx → `OfferCreateRejectedException` (adapterKey + statusCode set); `errors[].message` does NOT contain raw responseBody; auth error propagates.

### Phase 3 — Classifiers
6. **`ErliRetryClassifierAdapter` + `ErliAuthFailureClassifierAdapter`** over the typed exceptions. **Acceptance**: unit tests — `ErliApiException`/`ErliAuthenticationException` → non-retryable; `ErliNetworkException`/`ErliRateLimitException` → retryable; `ErliAuthenticationException` → credential-rejected.

### Phase 4 — Factory + plugin wiring
7. **`ErliAdapterFactory.createAdapters(connection, identifierMapping, credentialsResolver)`** + `ErliAdapters`. **Acceptance**: returns `offerManager` passing `isOfferCreator` + `isOfferFieldUpdater`.
8. **`erli-plugin.ts`** — manifest `['OfferManager']`; dispatch table; classifier registration. **Edit the existing `erli-plugin.spec.ts` concretely**: (a) remove `'OfferManager'` from the `it.each([...])` reject list (leave `'OrderSource'`/`'ProductMaster'`); (b) flip `supportedCapabilities` assertion `[]`→`['OfferManager']`; (c) the new positive dispatch test needs a host stub with a working `credentialsResolver` mock (current bare `{} as HostServices` only works because dispatch threw before touching the host); (d) assert classifier registries `.register` called at `erli.shopapi.v1`. **Acceptance**: `OfferManager` resolves; unknown capability still throws; manifest + dispatch asserted in the same test (can't drift).

### Phase 5 — Quality gate
9. Build upstream deps first (`pnpm --filter "@openlinker/integrations-erli^..." build`), then type-check + lint + test + `pnpm check:invariants`.

---

## 7. Alternatives Considered

- **202 → `'active'`** (optimistic): rejected — violates ADR-025; shows "live" offers Erli may reject.
- **202 → `'validating'`** (original rev. 1): rejected — schedules the #989 poll that fails as `OFFER_POLL_NOT_SUPPORTED` until `OfferStatusReader` exists. `'draft'` is the correct interim mapping.
- **Drop `identifierMapping` from `createAdapters`** (rev. 1): rejected — mirrors Allegro's churn-avoidance precedent (Allegro keeps unused `_customerIdentityResolver` for the same reason); keeping it spares #985/#986/#988 a factory-signature refactor and preserves the id-recovery path if Q2 changes the id derivation.
- **Erli-assigned offer id**: rejected — spec/ADR describe a seller-keyed resource; caller-assigned id is what makes the write idempotent.
- **Defer classifier registration to a later issue**: rejected — the #981 exception docblocks + barrel assign it to #984, and §4.2's `needs_reauth` behaviour is non-existent without it (revoked keys would retry-storm).

---

## 8. Validation & Risks

- **Architecture**: ✅ Integration-only; core ports via barrel; typed exceptions; `*.types.ts` wire types (correct in `infrastructure/adapters/`); no CORE/orm/deep-path imports.
- **Naming**: ✅ `ErliOfferManagerAdapter`, `ErliRetryClassifierAdapter`, `ErliAuthFailureClassifierAdapter`.
- **Idempotency**: ✅ deterministic seller-keyed id + `POST {idempotent:true}` + idempotent PATCH.
- **Security S1 — path injection via `{externalId}`** (MEDIUM): mitigated by `resolveErliProductId` allowlist + `encodeURIComponent` (the #981 origin-pin is defense-in-depth only; it does not stop same-origin `../`). Hostile-id unit test required.
- **Security S2 — `responseBody` leak** (MEDIUM): the create-error mapper must never promote the diagnostics-only `responseBody` into operator-facing `validationErrors[].message`; parse structured errors or emit a generic message, raw body to `debug` only. Test asserts message excludes raw body. (Bearer key itself is header-only — not in any surfaced exception.)
- **Risk R1 — created offer shows `'draft'` until #989**: by-design; `'draft'`→`'ok'` outcome, no false failure, no poll. #989 surfaces accepted/active/rejected.
- **Risk R2 — category-less create may async-reject (#985)**: #984 still correctly *submits*; async rejection is surfaced by #989, not a #984 bug. "Appears in panel" AC is jointly gated on #985 + #992.
- **Risk R3 — provisional wire/id/error shapes (#992)**: isolated in `erli-product.types.ts`, `resolveErliProductId`, and the create-error mapper; HTTP-mocked tests assert mapping behaviour, not live acceptance.
- **Backward compatibility**: ✅ additive; `[]`→`['OfferManager']` satisfies the #980 manifest-vs-factory invariant (the factory can now construct the declared capability).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests (`pnpm --filter @openlinker/integrations-erli test`; mock `global.fetch` / `IErliHttpClient`)
- **id resolver**: hostile ids rejected/encoded; valid → `products/<encoded>`.
- **Adapter**: createOffer 202→`status:'draft'` + externalOfferId; createOffer 4xx→`OfferCreateRejectedException` (adapterKey + statusCode set) whose `errors[].message` excludes raw responseBody; auth error propagates; updateOfferFields sparse body; updateOfferQuantity body=`{stock}`; POST sends `idempotent:true`.
- **Classifiers**: retry + auth-failure classification per exception type.
- **Factory**: `createAdapters` returns `offerManager` satisfying `isOfferCreator`/`isOfferFieldUpdater`.
- **Plugin**: `OfferManager` resolves; unknown capability throws; manifest `['OfferManager']`; classifier registries `.register` called; existing `it.each` reject list updated.

### Integration tests
- Deferred to **#991**.

### Acceptance criteria (issue #984)
- [ ] `createOffer` POSTs the seller-keyed product (encoded/validated id); 202 → `'draft'`, never a false failure, never schedules a poll.
- [ ] `updateOfferFields` + `updateOfferQuantity` issue sparse PATCHes touching only intended fields.
- [ ] `OfferManager` resolves through the plugin; manifest declares it; retry + auth-failure classifiers registered (revoked key → `needs_reauth`, not retry-storm).
- [ ] Create rejection never leaks raw `responseBody` to operator-facing messages.
- [ ] Unit tests green; no new ESLint/type errors; `check:invariants` green.

---

## 10. Alignment Checklist
- [x] Hexagonal (Integration adapter implements CORE ports; classifiers via host registries)
- [x] CORE vs Integration boundary respected (CORE untouched)
- [x] Reuses #981 client / #982 factory / Allegro dispatch + classifier precedent — no new abstractions
- [x] Idempotency (seller-keyed id + `idempotent:true`)
- [x] Reconciliation-first / async-202 honoured (`'draft'`, ADR-025)
- [x] Rate limits & retries addressed (#981 client + RetryClassifier)
- [x] Error handling comprehensive + secret-safe (`OfferCreateRejectedException`, no responseBody leak, auth classifier)
- [x] Security: path-injection + responseBody findings folded in as ACs
- [x] Testing strategy complete (unit; int-specs → #991)
- [x] Naming + file structure per standards
- [x] No new ADR required (ADR-025 governs)
- [x] Execution-ready

## Related Documentation
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md)
- [ADR-025](../architecture/adrs/025-erli-marketplace-adapter.md) · [ADR-008](../architecture/adrs/008-auth-failure-classifier-connection-reauth.md) · Spec #978
