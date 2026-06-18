# Implementation Plan — Shipping/DPD hardening round 2 (#1103, #1104, #1105)

Follow-ups to PR #1102. Three cohesive shipping-domain fixes in one branch
(`1103-1105-shipping-followups`).

---

## 1. Understand the task

| Issue | Goal | Layer |
|---|---|---|
| #1103 | A carrier 401/403 flips the connection to `needs_reauth` | Integration (classifiers) + wiring |
| #1104 | DPD `NOT_PROCESSED` surfaces field-level `validationInfo` in `providerDetails` | Integration (DPD mapper) |
| #1105 | Integration test for the failed-pre-waybill retry against the real UQ constraint | CORE testing |

**Non-goals**: no new HTTP-client behaviour; no change to the 502 mapping shipped in #1102; no move of shipping dispatch onto the job bus.

---

## 2. Research findings (live repo)

- **Auth-failure classifier seam (#819, ADR-008)**: `AuthFailureClassifierPort.isCredentialRejected(cause)` (`libs/core/src/sync/domain/ports/auth-failure-classifier.port.ts`). Consumed **only** by `SyncJobRunner` (`apps/worker/src/sync/sync-job.runner.ts:315` → `flagConnectionNeedsReauth(job.connectionId)` → `connectionPort.update(id, { status: 'needs_reauth' })`). Registered per-plugin via `host.authFailureClassifierRegistry.register(...)`.
- **Precedent**: `AllegroAuthFailureClassifierAdapter` is a one-liner — `return cause instanceof AllegroAuthenticationException`. Registered in `allegro-plugin.ts:119`.
- **Shipping runs on the job path**: `apps/worker/src/sync/handlers/marketplace-shipment-status-sync.handler.ts`, `…fulfillment-status-sync.handler.ts`, `…shipment-sync-by-external-id.handler.ts` all run through `SyncJobRunner`. So a carrier credential rejection thrown on a background sync **already reaches the classifier dispatch** — it just returns `false` today because no shipping classifier is registered.
- **Synchronous path is separate**: `POST /shipments/generate-label` → `ShipmentDispatchService` (no `SyncJobRunner`). `shipment.controller.ts:404` maps `ShippingProviderAuthException` → 502 and the `:409` comment marks the needs_reauth flip as this issue's deferred work.
- **DPD/InPost plugins** both expose `register(host)` and already call `host.*Registry.register(...)` — the classifier registry is available on the same bag.
- **#1104**: `reject()` (`dpd-shipment.mapper.ts:370`) already passes the **first** `DpdValidationInfo` as `providerDetails: { errorCode, info }`. `DpdValidationInfo` = `{ errorCode?: string; info?: string }` (`dpd-rest.types.ts:126`). `assertCreateSucceededAndExtractWaybill` picks one via `firstValidation(...)` (`:149`). The full array (package- + parcel-level) is discarded.
- **#1105**: `apps/api/test/integration/shipment-dispatch.int-spec.ts` is the existing harness (real Postgres via the test harness; `resetTestHarness()` between tests).

---

## 3. Design

### #1103 — needs_reauth on carrier auth failure

**Part A (in scope — mirrors Allegro):** register a classifier per shipping plugin that recognises the carrier's auth exception. Both `DpdUnauthorizedException` and `InpostUnauthorizedException` extend the core `ShippingProviderAuthException` (PR #1102), so the classifier is a one-liner.

- `DpdAuthFailureClassifierAdapter implements AuthFailureClassifierPort` → `cause instanceof DpdUnauthorizedException`.
- `InpostAuthFailureClassifierAdapter` → `cause instanceof InpostUnauthorizedException`.
- Register each in the plugin's `register(host)` via `host.authFailureClassifierRegistry.register(...)`.

Effect: any shipping **sync job** (status-sync / fulfillment-sync / sync-by-external-id) that fails with a carrier 401/403 now flags the connection `needs_reauth` — the silent-background-failure case, which is the high-value one.

**Part B (synchronous generate-label flag) — RECOMMEND SCOPING OUT, with reason:** the `POST /shipments/generate-label` path already returns an **actionable 502 to the operator in real time** (they're present and can react). The needs_reauth flag exists primarily to stop the *scheduler* from enqueuing dead-on-arrival background jobs — exactly what Part A covers. Wiring the synchronous controller path would add a connection-status-update dependency to the API shipping controller (or core dispatch service) for marginal value. Scope out here; tracked as a one-line note on #1103 for a future tiny follow-up if operators want the flag set on manual dispatch too.

> **Verified (tech-review):** the DPD SOAP InfoServices client throws the **same** `DpdUnauthorizedException` on 401/403 (`dpd-info-soap-client.ts:149,158`) as the REST client, and InPost uses a single `inpost-http-client.ts` that throws `InpostUnauthorizedException` for every path. Both extend `ShippingProviderAuthException` (#1102). So a classifier checking `instanceof DpdUnauthorizedException` / `instanceof InpostUnauthorizedException` fires on the `marketplace-shipment-status-sync` / `fulfillment-status-sync` job path — Part A delivers real behavior, no extra client changes needed.

### #1104 — carry full validationInfo into providerDetails

Change `reject()` to accept the **array** of `DpdValidationInfo` (or collect package + parcel `validationInfo` at the call sites in `assertCreateSucceededAndExtractWaybill`) and place all `{ errorCode, info }` entries in `providerDetails.validationInfo`, keeping the first `errorCode` as the `providerCode` discriminator. Backwards-compatible shape: `providerDetails = { errorCode, info, validationInfo: [...] }`.

### #1105 — integration test

New `apps/api/test/integration/shipment-dispatch-retry.int-spec.ts` mirroring `shipment-dispatch.int-spec.ts`: dispatch with a failing label → assert `failed` + null waybill row; re-dispatch → assert success, single row reused, no UQ violation.

---

## 4. Step-by-step implementation

1. **#1103a** `libs/integrations/dpd-polska/src/infrastructure/adapters/dpd-auth-failure-classifier.adapter.ts` — new adapter (**with the standard file header**, Allegro adapter as template) + `*.spec.ts`. Export from the package barrel (mirror Allegro). The spec asserts the **negative** too: `isCredentialRejected` → `true` for `DpdUnauthorizedException`, `false` for `ShippingProviderRejectionException` + a network exception (so a 422/validation reject never flags the connection).
2. **#1103a** Register it in `libs/integrations/dpd-polska/src/*plugin*.ts` `register(host)` via `host.authFailureClassifierRegistry.register(...)`.
3. **#1103a** Same for InPost: `inpost-auth-failure-classifier.adapter.ts` (+ file header) + spec (same negative assertion) + register in the InPost plugin.
4. **#1103b** Add a one-line note to #1103 documenting the synchronous-path scope-out (comment on issue at ship time).
5. **#1104** Extend `reject()` + the two call sites in `dpd-shipment.mapper.ts` to carry all `validationInfo` entries into `providerDetails` (additive shape `{ errorCode, info, validationInfo: [...] }`; quick-grep first for any consumer asserting the current exact shape); update `dpd-shipment.mapper.spec.ts` with a `NOT_PROCESSED` + `INCORRECT_*_POSTAL_CODE` case.
6. **#1105** Add `shipment-dispatch-retry.int-spec.ts`. **Force the failure deterministically**: register a stub `ShippingProviderManager` adapter via `AdapterRegistryService` + `AdapterFactoryResolverService` whose `generateLabel` rejects (mirrors `allegro-prestashop-carrier-mapping.int-spec.ts`'s stub-registration approach). Assert (a) a `failed` / null-waybill row after dispatch 1; (b) dispatch 2 for the same `(orderId, connectionId)` does **not** raise the `UQ_…` violation and leaves exactly one row. `maxWorkers:1` + `resetTestHarness()` per the testing guide.
7. Quality gate: `pnpm lint && pnpm type-check && pnpm test`, then `pnpm test:integration` for the new int-spec.

---

## 5. Validation

- **Architecture**: classifiers live in each plugin's `infrastructure/adapters/`, implement the core `AuthFailureClassifierPort`, registered via `HostServices` — no CORE ↔ Integration violation. #1104 stays inside the DPD plugin. #1105 is test-only.
- **Naming**: `*-auth-failure-classifier.adapter.ts` / `{Platform}AuthFailureClassifierAdapter` (matches Allegro).
- **Testing**: unit spec per classifier; mapper spec for #1104; int-spec for #1105.
- **Risk**: the only real unknown is whether DPD background tracking auth throws `DpdUnauthorizedException` (REST) vs a SOAP exception — verified during step 1–2; if divergent, noted as a follow-up rather than expanding this PR.
