/**
 * Order Amendment Kind (#2305, ADR-059 / ADR-044; design §6.2)
 *
 * What kind of change an ADR-044 change proposal asks for. Each of the four
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
 * The four amendment kinds.
 *
 * - `address-change`         — redirect the delivery address.
 * - `line-quantity-change`   — change a line's quantity. **Admissible only
 *   against a destination shop OL created the order in** (design §6.2): no
 *   marketplace in scope supports partial cancellation, so a marketplace
 *   adapter answers `unsupported` per ADR-027 rather than pretending.
 * - `cancel-request`         — ask the authority to cancel; OL proposes, the
 *   authority disposes, OL confirms from observation (ADR-044).
 * - `delivery-method-change` — change the carrier / delivery option.
 */
export const OrderAmendmentKindValues = [
  'address-change',
  'line-quantity-change',
  'cancel-request',
  'delivery-method-change',
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
