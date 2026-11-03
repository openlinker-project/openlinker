/**
 * PrestaShop order-reference derivation
 *
 * Stock PrestaShop's `ps_orders.reference` column is `VARCHAR(9)` — PrestaShop
 * itself generates references via `Tools::passwdGen(9)`. Deployments
 * typically run MySQL without strict mode, so an INSERT carrying a longer
 * string is silently TRUNCATED to 9 characters rather than rejected (#3473).
 *
 * OpenLinker sends `order.orderNumber` verbatim as `order_reference` to the
 * OL module's `importorder` endpoint (ADR-016 / #905), which forwards it to
 * `PaymentModule::validateOrder`. For an Allegro order, `orderNumber` is the
 * `checkoutFormId` — a 36-character UUID — so it is stored truncated to its
 * first 9 characters. `findExistingOrderByReference` does an EXACT
 * `filter[reference]` lookup against the full 36-character value, which can
 * never match the truncated row: a retry after a lost `importorder` response
 * therefore never recovers the order it already created, and creates a
 * SECOND one.
 *
 * `derivePrestashopOrderReference` collapses any reference longer than the
 * column to a deterministic 9-character digest, used both for the value SENT
 * to `importorder` and for the value the recovery lookup searches by — so the
 * two can never disagree. A reference already within the column width is
 * passed through unchanged, so this is a no-op for the common case (a native
 * PrestaShop order, or any source whose reference already fits).
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import { createHash } from 'crypto';

/** `ps_orders.reference` column width in stock PrestaShop. */
export const PRESTASHOP_ORDER_REFERENCE_MAX_LENGTH = 9;

/**
 * Derive a PrestaShop-safe order reference from a (possibly longer) source
 * order number.
 *
 * A SHA-256 digest's leading hex characters are used rather than truncating
 * the source string itself — plain truncation would collide for any two ids
 * sharing a long common prefix (e.g. two orders from the same batch import),
 * while a hash prefix spreads collisions uniformly across the whole input.
 * Deterministic: the same `orderNumber` always derives the same reference,
 * which is what lets a retry's lookup find what an earlier attempt created.
 */
export function derivePrestashopOrderReference(orderNumber: string): string {
  const trimmed = orderNumber.trim();
  if (trimmed.length === 0 || trimmed.length <= PRESTASHOP_ORDER_REFERENCE_MAX_LENGTH) {
    return trimmed;
  }
  return createHash('sha256')
    .update(trimmed)
    .digest('hex')
    .slice(0, PRESTASHOP_ORDER_REFERENCE_MAX_LENGTH);
}
