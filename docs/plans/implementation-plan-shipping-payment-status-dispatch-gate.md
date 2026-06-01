# Implementation Plan — Server-side payment-status gate on dispatch (#938)

## 1. Understand the task

**Goal.** The FE-only Generate-label gate from #928 is a UX affordance, not enforcement — an authenticated operator can still POST the dispatch endpoint for an `awaiting`/`refunded` order. Add the durable server-side guard in `ShipmentDispatchService.dispatch()`: block dispatch when the order's payment status is in the block set, returning HTTP 422.

**Layer.** CORE (application-service precondition + new domain exception) + Interface (HTTP 422 mapping). No schema change, no migration.

**Non-goals.**
- Wiring the live dispatch call-site (#769/#771) — out of scope; this guards the path it will trigger.
- Changing the FE gate (#928 already shipped it).
- Any new persisted state.

## 2. Research (findings)

- `ShipmentDispatchService.dispatch(input: ShipmentDispatchInput)` (`libs/core/src/shipping/application/services/shipment-dispatch.service.ts`): calls `routing.resolve(...)` then `switch`es on the processor kind (`omp_fulfilled` → no-op; `ol_managed_carrier` / `source_brokered` → `dispatchViaShippingProvider` → `generateLabel`; default → `UndispatchableResolutionException`). **`input.orderId` is available** (ShipmentDispatchInput carries the internal order id).
- `IOrderRecordService` + `ORDER_RECORD_SERVICE_TOKEN` are exported from `@openlinker/core/orders`. `getOrderRecord(internalOrderId): Promise<OrderRecord | null>`; `OrderRecord.orderSnapshot` is `Record<string, unknown>` (payment status is a loose JSON key: `orderSnapshot.paymentStatus`).
- `PaymentStatus` (`'paid' | 'cod' | 'awaiting' | 'refunded'`), `PaymentStatusValues`, `PAYMENT_STATUS` — `libs/core/src/orders/domain/types/payment-status.types.ts`, exported from `@openlinker/core/orders`.
- **FE block polarity** (`apps/web/.../shipment-action-buttons.tsx`): `PAYMENT_BLOCKS_DISPATCH = new Set(['awaiting','refunded'])`; `paid`/`cod`/`undefined`/unknown all **permit**. Mirror exactly.
- HTTP mapping: `shipment.controller.ts` `toHttpException()` maps `UndispatchableResolutionException` (+ peers) → `UnprocessableEntityException` (422). Add the new exception to that group.
- **`ShippingModule` already imports `OrdersModule`** (#837) → `ORDER_RECORD_SERVICE_TOKEN` is injectable into `ShipmentDispatchService` with no module change.
- Spec (`shipment-dispatch.service.spec.ts`) constructs the SUT directly with `jest.Mocked` ports; add a `getOrderRecord` mock + 4th constructor arg.

## 3. Design

**Gate placement.** Immediately after `routing.resolve(...)` returns, **before the `switch`** — the literal reading of the issue ("in `dispatch()`, after the routing resolve, before `generateLabel`") and the faithful mirror of the FE gate, which is processor-kind-agnostic (gates on status + payment only). Routing errors still surface first (resolve precedes the payment check).

```ts
const order = await this.orders.getOrderRecord(input.orderId);
const paymentStatus = order?.orderSnapshot?.paymentStatus;
if (typeof paymentStatus === 'string' && BLOCKED_PAYMENT_STATUSES.has(paymentStatus as PaymentStatus)) {
  throw new OrderNotDispatchablePaymentStatusException(input.orderId, paymentStatus);
}
```

- `BLOCKED_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set([PAYMENT_STATUS.Awaiting, PAYMENT_STATUS.Refunded])` — module const, mirrors FE.
- `order === null` or `paymentStatus` absent/non-string → permit (graceful degradation for PrestaShop / legacy orders), matching the FE's `undefined`-permits polarity.
- New domain exception `OrderNotDispatchablePaymentStatusException(orderId, paymentStatus)` under `libs/core/src/shipping/domain/exceptions/`, mirroring `UndispatchableResolutionException`'s shape.

**Cross-context edge.** `shipping → orders` strictly via the `IOrderRecordService` barrel contract + Symbol token + `PaymentStatus` type/const — all allowed cross-context shapes (no repository port, no ORM entity). Documented edge already exists at the module layer (#837).

## 4. Implementation steps

1. **`libs/core/src/shipping/domain/exceptions/order-not-dispatchable-payment-status.exception.ts`** (new) — `OrderNotDispatchablePaymentStatusException extends Error`, carrying `orderId` + `paymentStatus`, clear message. AC: file header, `Error.captureStackTrace`.
2. **`shipment-dispatch.service.ts`** — inject `@Inject(ORDER_RECORD_SERVICE_TOKEN) IOrderRecordService`; add module-const block set; insert the gate after `routing.resolve`. AC: blocked statuses throw before any `generateLabel`; permitted statuses unaffected.
3. **`apps/api/src/shipping/http/shipment.controller.ts`** — import + add the new exception to the 422 branch of `toHttpException()`; add `@ApiResponse(422)` note if useful. AC: blocked dispatch → 422.
4. **`shipment-dispatch.service.spec.ts`** — add `orderRecordService` mock + 4th ctor arg; tests: blocked for `awaiting`/`refunded` (throws, `generateLabel` not called), permitted for `paid`/`cod`/`undefined`/null order. AC: all green; existing tests unaffected (default `getOrderRecord` → undefined → permit).
5. **(maybe) controller spec** — if `shipment.controller.spec.ts` exists and tests `toHttpException`, add a 422 case for the new exception.

## 5. Validation

- Architecture: precondition is application-layer orchestration in core; new exception in `domain/exceptions/`; cross-context via `I*Service` + token only. ✅
- Naming: `*.exception.ts`, `{Reason}Exception`. ✅
- Types: reuse existing `PaymentStatus`; no inline type defs; no `any` (narrow `unknown` via `typeof`). ✅
- Testing: unit tests mock ports; run `pnpm test` + full `pnpm test:integration` (the issue's AC asks for green integration — routing/dispatch int-specs exercise this service). ✅
- Security: defense-in-depth enforcement moved server-side; no secrets. No migration.

## Tech-review resolutions (applied)

- **Typed accessor, not a snapshot-key read.** Added a pure read-only getter `OrderRecord.paymentStatus: PaymentStatus | undefined` (ADR-011-compliant) in the orders context; the gate reads `order?.paymentStatus`, so shipping binds to a typed contract and the `orderSnapshot.paymentStatus` key + narrowing live in the owning context.
- **Fails closed.** `getOrderRecord` is awaited with no permit-on-error catch — a read failure propagates (→ 500), never silently permits. Covered by a "fail closed (propagate) when the read throws" test.
- **422 mapping tested.** Added the controller-spec case asserting `OrderNotDispatchablePaymentStatusException → UnprocessableEntityException` (the explicit AC).
- **Named block-set.** `DISPATCH_BLOCKING_PAYMENT_STATUSES` lives in `shipping/application/types/dispatch-payment-policy.types.ts` (application layer — it's a shipping *policy* needing a sibling-context value, kept out of the domain layer) with a comment pointing at the FE counterpart (drift note, both directions); the service builds a `Set` from it once.
- **Audit log on block.** The gate emits a `logger.warn` before throwing — a bypassed-FE dispatch attempt on a payment-blocked order is a notable signal (the 422 itself isn't logged by the controller).
- **Idempotency edge** documented in the gate comment: a `paid→dispatched→refunded` order is refused (422) on repeat rather than returning the existing shipment — intended.
- **Constructor arity:** only DI (class provider) + the unit spec construct `ShipmentDispatchService`; spec updated. No other `new` sites.

## Risks / open questions

- **Gate covers the OMP-fulfilled branch too** (it's before the switch). That's intended — it mirrors the processor-kind-agnostic FE gate and the issue's "in `dispatch()`" placement. Net effect: an `awaiting`/`refunded` OMP-fulfilled order is also refused, which is the correct defense-in-depth posture. Calls out in the plan in case reviewers prefer scoping it to the shipping-provider branch only.
- **One extra `getOrderRecord` read per dispatch** — dispatch is low-frequency; acceptable.
- Dispatch call-site not yet live (#771) — guard protects a not-yet-triggered path (issue acknowledges; still correct to land).
