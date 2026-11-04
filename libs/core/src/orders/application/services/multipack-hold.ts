/**
 * Multipack hold (#3929)
 *
 * An order line sold as a multipack (`packQuantity > 1`, e.g. an Allegro offer
 * whose product set holds several units) has to expand to N units of its
 * variant before anything is reserved or shipped. Until the operator can define
 * that expansion (bundle definitions, #3607) the only honest answer is to hold
 * the order: mapping the offer to one variant would reserve and ship a single
 * unit for the price of several.
 *
 * @module libs/core/src/orders/application/services
 */
import type { IncomingOrderItem } from '../../domain/types/incoming-order.types';

/**
 * Stable operator-facing code for the hold, embedded in the persisted
 * `mappingFailureReason` so a surface can recognise it without parsing prose.
 */
export const MULTIPACK_WITHOUT_BUNDLE_REASON_CODE = 'multipack-without-bundle';

/** True when the line sells more than one unit of its variant per sold unit. */
export function isMultipackLine(item: Pick<IncomingOrderItem, 'packQuantity'>): boolean {
  return item.packQuantity !== undefined && item.packQuantity > 1;
}

/**
 * THE seam #3607 plugs into: does this variant have a bundle definition that
 * expands a multipack into component units?
 *
 * Returns `false` until bundle definitions exist, which holds every multipack.
 * Replace the body, not the call site, so the hold in ingestion stays untouched.
 */
export function hasBundleDefinition(
  _internalProductId: string,
  _internalVariantId: string | undefined
): Promise<boolean> {
  return Promise.resolve(false);
}

/** The reason text persisted on the held order. */
export function describeMultipackHold(item: Pick<IncomingOrderItem, 'packQuantity' | 'name'>): string {
  const label = item.name ? ` "${item.name}"` : '';
  return `multipack without a bundle [${MULTIPACK_WITHOUT_BUNDLE_REASON_CODE}]: line${label} sells ${item.packQuantity} units per unit ordered and no bundle defines them`;
}
