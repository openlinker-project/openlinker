# Pre-implement readiness — #953 / #954 (generate-label toast + pickup hint)

**Plan:** `docs/plans/implementation-plan-953-954-label-form-toast-and-pickup-hint.md`
**Run:** retroactive (implementation already in progress; run to dogfood the gate)

## Verdict: READY

A self-contained FE bug-fix pair confined to one component + its test. No new backend artifacts, no contract-surface changes.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `classifyDeliveryMethod()` + `LOCKER_METHOD_RE` (locker-vs-courier helper) | **NEW — confirmed absent** | No existing locker/paczkomat classifier anywhere in `apps/web/src` (grep for `classifyDelivery\|isLocker\|isPaczkomat\|lockerMethod\|LOCKER_` returned only unrelated `BLOCKER_CHIPS`). Genuinely new; nothing to reuse. |
| `isLikelyCourier` gate on `showPickupRetryHint` | edit of existing local logic | `generate-label-form.tsx` only |
| `result.kind` toast branch (#953) | edit of existing local logic | `DispatchResult.kind` already exists (`shipments.types.ts:151`) — consumed, not added |
| Ports / services / DI tokens / ORM entities / DTOs / capabilities | **none created** | plan is FE-only |

## Backward-compatibility findings

| Surface | Result |
|---|---|
| Feature public barrel (`features/orders/index.ts`) | **No risk** — exports only `ordersQueryKeys` + order types; `GenerateLabelForm` is an internal component (not re-exported). Editing it can't break cross-feature/plugin consumers. |
| Snapshot schema (`order-snapshot.schema.ts`) | **Unchanged** — `orderShippingSchema` (`methodId`/`methodName`) already exists; the fix reads it, doesn't alter it. |
| `DispatchResult` shape | **Unchanged** — `kind` already on the type; only the consumer branches. |
| Port signatures / Symbol tokens / ORM schema / migrations | **N/A** — none touched. |
| `check:invariants` (cross-context, repo-URL, service-interface…) | **No risk** — FE-only, no `@openlinker/core` deep imports, no repo URLs. |

## Open questions / sibling-bug sweep (apply-elsewhere)

The fix touches trait-driven logic (`pickupPointResolvesAsync`). Swept the two sibling consumers for the same courier false-positive:

- `order-delivery-panel.tsx:93` — pickup caption renders only `{pickupPoint ? … }` (gated on pickup-point presence). **No false-positive.**
- `order-shipment-panel.tsx:207` — paczkomat row renders only when `shipment.paczkomatId !== null`. **No false-positive.**

Neither sibling shows the affected affordance for courier orders, so **no follow-up is warranted** — #954 is correctly scoped to `generate-label-form.tsx` alone.

## Notes

- #954's interim full-street-address heuristic is documented in-code and converges with the parallel #952 work (which populates `snapshot.shipping.methodId`) — the classifier already prefers the method when present, so no rework when #952 lands.
