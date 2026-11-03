/**
 * Order Amendment Kind (#2305, ADR-059 / ADR-044; design §6.2)
 *
 * What kind of change an ADR-044 change proposal asks for. Each of the five
 * values is justified by a REAL remote verb on at least one in-scope
 * destination — the union is not a taxonomy of everything an order could
 * conceivably change, it is the set of changes some adapter can actually be
 * asked to perform.
 *
 * Consumed as `order_changes.kind` (ADR-044 as specified, plus this field) and
 * as the discriminating payload of the `amendment-*` members of
 * `OmsLifecycleFact`. An open amendment is what derives the `amending` phase.
 *
 * @module libs/core/src/order-lifecycle/domain/types
 * @see docs/architecture/adrs/044-order-changeset-proposed-then-confirmed.md
 */

/**
 * The five amendment kinds.
 *
 * - `address-change`         — redirect the delivery address.
 * - `line-quantity-change`   — change a line's quantity. **Lower only.** The
 *   original reading (design §6.2) admitted it only against a destination shop
 *   OL created the order in, because no marketplace in scope supports partial
 *   cancellation. Decision D9 (#3542) supersedes that: with the OMS on,
 *   OpenLinker owns the order, so the edit is an OpenLinker-side amendment
 *   "confirmed at write time" - applied to an overlay and confirmed the instant
 *   it is written, with nothing waiting on a channel (see below). The channel
 *   keeps its original; no adapter is asked to change anything.
 * - `cancel-request`         — ask the authority to cancel; OL proposes, the
 *   authority disposes, OL confirms from observation (ADR-044).
 * - `delivery-method-change` — change the carrier / delivery option.
 * - `discount-change`        — change the order-level discount (#3543). Like
 *   the quantity edit it is an OpenLinker-side overlay amendment, confirmed at
 *   write time; it corresponds to the `order.discount_change` change kind.
 *
 * ## Two shapes of amendment
 *
 * `cancel-request` is a REQUEST a channel answers: it stays open until the
 * channel disposes of it and is what derives the `amending` phase. The other
 * four are, with the OMS on (D9, #3542), CONFIRMED AT WRITE TIME: the operator's
 * submit applies them to the OpenLinker order and confirms the change row in the
 * same breath, so they never derive `amending`. Only a channel that supports the
 * change would also be written back to, and none of the four adapters does today.
 */
export const OrderAmendmentKindValues = [
  'address-change',
  'line-quantity-change',
  'cancel-request',
  'delivery-method-change',
  'discount-change',
] as const;

export type OrderAmendmentKind = (typeof OrderAmendmentKindValues)[number];

/**
 * Coerce an untrusted value to the union. Pure; no default — an unrecognised
 * kind must not silently become a `cancel-request`.
 */
export function isOrderAmendmentKind(
  value: unknown,
): value is OrderAmendmentKind {
  return (
    typeof value === 'string' &&
    (OrderAmendmentKindValues as readonly string[]).includes(value)
  );
}
