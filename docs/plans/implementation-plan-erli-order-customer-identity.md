# Implementation Plan: Email-only customer identity resolution for Erli orders (BUG-2 / #1208 item 2)

**Date**: 2026-06-24
**Status**: Ready for Review
**Estimated Effort**: ~2 hours

---

## 1. Task Summary

**Objective**: An Erli order ingests cleanly (`order_records.recordStatus = ready`) but its downstream sync to the PrestaShop destination fails with `"Customer ID is required for PrestaShop order creation. Ensure customer identity is resolved before order creation."`. Make an Erli order resolve an internal customer from its `customerEmail` alone so the destination order-create has a `customerId`.

**Context**: Erli's buyer identity is baseline-only (#995): the order carries `user.email` and **no buyer id**. The Erli order mapper correctly emits `customerEmail` with **no** `customerExternalId`. But `OrderIngestionService.resolveCustomerId` short-circuits to `undefined` whenever `customerExternalId` is absent — it never looks at `customerEmail`. The unified `Order` is then built with `customerId: undefined`, and `PrestashopOrderProcessorManagerAdapter.createOrder` throws because PrestaShop requires a customer. Real example: external order `260618x10002`.

**Classification**: CORE (orders application service — customer-identity resolution policy).

---

## 2. Scope & Non-Goals

### In Scope
- Allow `OrderIngestionService.resolveCustomerId` to resolve an internal customer when **only** `customerEmail` is present (no `customerExternalId`), via the existing `CustomerIdentityResolverService` email-fallback path.
- Unit tests for the new email-only branch.

### Out of Scope
- Changes to the Erli adapter/mapper (they already emit the correct neutral shape).
- Changes to the PrestaShop order-processor guard (the "Customer ID is required" throw is the correct fail-closed behaviour — the fix is to *supply* a customerId, not to relax the guard).
- `external_only` identity-mode behaviour redesign for email-only sources (documented assumption below).
- Any schema/migration change.

### Constraints
- Backward compatible: existing `customerExternalId`-present paths must be unchanged.
- MVP / localized: a single core service method changes.

---

## 3. Architecture Mapping

**Target Layer**: CORE — `libs/core/src/orders/application/services/order-ingestion.service.ts`.

**Capabilities / services involved**:
- `ICustomerIdentityResolverService.resolveCustomerIdentity({ externalBuyerId, email, sourceConnectionId })` — already implements email-fallback resolution (projection lookup by `emailHash`, single-match reuse, collision → new customer).
- `IIdentifierMappingService` — unchanged.

**Existing services reused**: `CustomerIdentityResolverService` (no change). The bug is purely the entry guard in `OrderIngestionService`, which never reaches the resolver for email-only orders.

**New components**: none.

**Core vs Integration justification**: This is core customer-identity policy. The Erli adapter already fulfils its contract — it emits a neutral `IncomingOrder` with `customerEmail` and no buyer id, exactly as documented (architecture-overview.md §Customers, and the Erli mapper/email-normalizer file headers). Resolving an internal customer from that neutral shape is core's job; pushing it into the adapter would bleed identity-resolution domain logic into an integration (forbidden by the CORE↔Integration boundary).

---

## 4. External / Domain Research

### Internal patterns
- `CustomerIdentityResolverService.resolveViaEmailFallback` already keys customer reuse on `emailHash` and **uses `externalBuyerId` as the identifier-mapping key** for the `Customer` entity on the source connection. For an email-only source the email is the only stable buyer identity, so using the (raw) email as that mapping key is correct and stable across re-polls.
- `IncomingOrder.customerEmail` is documented as "Used by core to … enable email-fallback identity resolution" — the type already anticipates this path.
- The PrestaShop processor (`prestashop-order-processor-manager.adapter.ts`) provisions a guest customer from the customer **projection** (`normalizedEmail`). `resolveCustomerIdentity` upserts that projection as a side effect, so once core resolves an internal customerId the projection the PS adapter needs will exist.

### Root cause (confirmed by reading source)
`order-ingestion.service.ts` `resolveCustomerId`:
```ts
if (!incoming.customerExternalId) {
  return undefined;          // ← Erli hits this; customerEmail ignored
}
```

---

## 5. Questions & Assumptions

### Assumptions
- **Email is the buyer-identity key for email-only sources.** When `customerExternalId` is absent but `customerEmail` is present, pass the (raw, un-normalized) `customerEmail` as `externalBuyerId` to `resolveCustomerIdentity`. The resolver normalizes/hashes for projection matching internally; the raw email is only the identifier-mapping key, scoped to the source connection. This matches the resolver's existing single-source-of-truth for normalization (the per-connection `EmailNormalizerPort`).
- **`external_only` mode**: in `external_only`, `resolveCustomerIdentity` with `externalBuyerId = email` simply `getOrCreateInternalId`s a customer keyed by that email — still yielding a usable customerId (no incorrect cross-buyer merge, because no email-hash reuse happens in that mode). Acceptable and arguably correct for an email-only source.
- No order with **neither** `customerExternalId` nor `customerEmail` regresses: that case still returns `undefined` (PS would still throw — but that is a genuinely un-resolvable order, unchanged behaviour).

### Documentation gaps
- None blocking. The `IncomingOrder.customerEmail` doc-comment already covers the intended use.

---

## 6. Proposed Implementation Plan

### Phase 1: Core fix

1. **Extend `resolveCustomerId` to handle the email-only case**
   - **File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`
   - **Action**: Replace the `if (!incoming.customerExternalId) return undefined;` early return with branch logic:
     - If `customerExternalId` present → unchanged (existing two branches).
     - Else if `customerEmail` present → call `resolveCustomerIdentity({ externalBuyerId: incoming.customerEmail, email: incoming.customerEmail, sourceConnectionId: connectionId })` and return `internalCustomerId`.
     - Else → `return undefined` (unchanged terminal case).
   - **Acceptance**: An incoming order with only `customerEmail` resolves a non-undefined customerId via `resolveCustomerIdentity`.
   - **Dependencies**: none.

### Phase 2: Tests

2. **Add unit tests for the email-only branch**
   - **File**: `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts`
   - **Action**: Add cases:
     - `should resolve customer via email when customerEmail is present but customerExternalId is absent` — asserts `resolveCustomerIdentity` called with `externalBuyerId = email` and the resolved id lands on the persisted order.
     - `should return undefined when neither customerExternalId nor customerEmail is present` — asserts `resolveCustomerIdentity` and `getOrCreateInternalId('Customer', …)` are both NOT called and customerId is undefined (regression guard).
   - **Acceptance**: `pnpm --filter @openlinker/core test -- order-ingestion` green.

---

## 7. Alternatives Considered

### Alternative 1: Relax the PrestaShop "Customer ID is required" guard
- **Description**: Let the PS adapter provision a guest customer when `order.customerId` is absent, deriving email from the order/projection.
- **Why rejected**: Moves identity-resolution responsibility into the destination adapter, duplicates the core resolver, and the PS adapter has no buyer-identity context for marketplaces other than what core already resolved. Fail-closed in the adapter is the correct posture; the real defect is upstream (core never resolved a customer).

### Alternative 2: Resolve customer identity inside the Erli adapter
- **Description**: Have the Erli `OrderSource` adapter emit a resolved internal `customerExternalId`/id.
- **Why rejected**: Adapters MUST NOT emit internal OpenLinker ids (`IncomingOrder` contract). Identity resolution is core policy; this bleeds domain logic into an integration.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Fix lives in core application layer; no CORE↔Integration boundary crossing; adapters unchanged.

### Naming Conventions
- ✅ No new files/types; existing method extended.

### Risks
- **Cross-buyer merge under `email_fallback`**: governed entirely by the existing resolver (single-match reuse, >1 match → new customer). The Erli email normalizer is baseline-only (#995) precisely to avoid `+suffix`-stripping merges. This fix does not change that surface — it only *reaches* the resolver for email-only orders, the same way an Allegro order with `customerExternalId + email` already does.
- **Re-poll stability**: the customer mapping is keyed by raw email on the connection, so re-ingesting the same order resolves the same customerId. ✅

### Edge Cases
- Neither id nor email → `undefined`, unchanged (genuinely un-resolvable).
- Empty-string email → treated as absent (falsy guard), falls to terminal `undefined`.

### Backward Compatibility
- ✅ `customerExternalId`-present orders take the identical pre-existing branches.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts` — email-only resolution branch + neither-present regression guard.

### Integration Tests
- Not required for this localized core-policy fix; covered by existing ingestion int-specs which keep passing.

### Acceptance Criteria
- [ ] Incoming order with only `customerEmail` resolves a non-undefined internal customerId.
- [ ] Resolution routes through `CustomerIdentityResolverService` (so the customer projection the PS adapter needs is upserted).
- [ ] Orders with `customerExternalId` are unchanged.
- [ ] Orders with neither id nor email still return `undefined`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (reuses `CustomerIdentityResolverService`; no new abstraction)
- [x] Idempotency considered (email-keyed mapping is stable across re-polls)
- [x] Error handling comprehensive (terminal `undefined` preserved)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
