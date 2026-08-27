/**
 * Buyer Tax Id Types
 *
 * The buyer's tax identifier as an order source reported it, plus the pure
 * rules that read it off an order and move it in and out of the persisted
 * column. Type and rules live together per `engineering-standards.md`
 * § "The pure-rule exception to types only": the functions ARE the rule for
 * the type, they take no dependency, and a change to the three states means
 * editing both halves in one commit.
 *
 * ## Three states, never two
 *
 * A buyer who has no tax id and a source that never said are different facts,
 * and collapsing them is what made `SalesDocumentOrderFacts.buyerHasTaxId`
 * unusable in the first place (ADR-041 decision 5). So:
 *
 * - `undefined` - the source did not assert anything. Unknown.
 * - `null` - the source asserted the buyer supplied no tax id.
 * - a non-empty string - the tax id, verbatim.
 *
 * The value is carried VERBATIM. It is never validated, normalised, stripped
 * of a country prefix, or checked against a national format: the invoicing
 * domain is country-agnostic by construction (ADR-026) and every national
 * specific belongs in the provider adapter that knows the regime.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { Address } from './order.types';

/**
 * A source-reported buyer tax id in one of its three states - see the module
 * doc comment. `undefined` is a member of the union deliberately, so a reader
 * that forgets the unknown case does not type-check.
 */
export type BuyerTaxId = string | null | undefined;

/**
 * Read the order's buyer tax id, billing address first.
 *
 * Billing wins because that is the address a fiscal document is issued to;
 * shipping is consulted only when billing asserted nothing, which covers the
 * common shop shape where one address plays both roles. An order with neither
 * address is unknown, not "has none".
 */
export function readBuyerTaxId(order: {
  billingAddress?: Address;
  shippingAddress?: Address;
}): BuyerTaxId {
  const billing = order.billingAddress?.taxId;
  if (billing !== undefined) {
    return billing;
  }
  return order.shippingAddress?.taxId;
}

/**
 * Does the buyer have a tax id? `undefined` when nothing was asserted - the
 * shape `SalesDocumentOrderFacts.buyerHasTaxId` widened to accept, so a rule
 * condition cannot silently misfire on an order OL knows nothing about.
 */
export function buyerHasTaxId(value: BuyerTaxId): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value !== null;
}

/**
 * Encode the three states into the single nullable `order_records.buyerTaxId`
 * column: `NULL` = not asserted, `''` = asserted to have none, otherwise the
 * id. One column rather than a value plus a flag, because a second column
 * would let the two drift into a combination that means nothing.
 *
 * A whitespace-only value encodes as asserted-none: a shop that stores a blank
 * tax field has told us the buyer has none, and trimming is not normalisation
 * of the identifier itself.
 *
 * Read the column back through {@link decodeBuyerTaxIdColumn}, never with a
 * bare `IS NOT NULL` - that reports true for the asserted-none row.
 */
export function encodeBuyerTaxIdColumn(value: BuyerTaxId): string | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? '' : trimmed;
}

/** Decode {@link encodeBuyerTaxIdColumn}. `undefined` for a NULL column. */
export function decodeBuyerTaxIdColumn(column: string | null | undefined): BuyerTaxId {
  if (column === null || column === undefined) {
    return undefined;
  }
  return column.length === 0 ? null : column;
}

/**
 * Coerce a raw source value into the three states.
 *
 * Adapters call this so every source agrees on what a blank field means. A
 * source that did not return the field at all yields `undefined`; a returned
 * blank yields `null`.
 */
export function readSourceBuyerTaxId(raw: string | null | undefined): BuyerTaxId {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}
