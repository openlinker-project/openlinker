/**
 * Multipack hold (#3929)
 *
 * An order line sold as a multipack (`packQuantity > 1`, e.g. an Allegro offer
 * whose product set holds several units) has to expand to N units of its
 * variant before anything is reserved or shipped. Unless the operator has defined that
 * expansion (a bundle definition, #3607) the only honest answer is to hold the
 * order: mapping the offer to one variant would reserve and ship a single
 * unit for the price of several.
 *
 * @module libs/core/src/orders/application/services
 */
import type { IBundleDefinitionService } from '@openlinker/core/products';
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
 * Does this variant have a bundle definition that expands a multipack into
 * component units (#3607)? A multipack line WITH a definition is not held: its
 * "N x product" definition expands like any other bundle, so `packQuantity` is
 * only a signal here and is never multiplied on top of the definition.
 */
export async function hasBundleDefinition(
  bundles: Pick<IBundleDefinitionService, 'findCurrentByVariantIds' | 'findConfirmedMultipacks'>,
  internalVariantId: string | undefined,
  packQuantity?: number
): Promise<boolean> {
  if (internalVariantId === undefined) {
    return false;
  }
  const definitions = await bundles.findCurrentByVariantIds([internalVariantId]);
  if (definitions.length > 0) {
    return true;
  }
  // #3624: the operator may instead have confirmed "N x this product", which
  // needs no bundle and no new product.
  if (packQuantity === undefined || packQuantity <= 1) {
    return false;
  }
  const confirmed = await bundles.findConfirmedMultipacks([
    { variantId: internalVariantId, packQuantity },
  ]);
  return confirmed.length > 0;
}

/** The reason text persisted on the held order. */
export function describeMultipackHold(item: Pick<IncomingOrderItem, 'packQuantity' | 'name'>): string {
  const label = item.name ? ` "${item.name}"` : '';
  return `multipack without a bundle [${MULTIPACK_WITHOUT_BUNDLE_REASON_CODE}]: line${label} sells ${item.packQuantity} units per unit ordered and no bundle defines them`;
}
