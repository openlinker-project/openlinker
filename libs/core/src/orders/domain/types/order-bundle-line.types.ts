/**
 * Order bundle line (#3624, ADR-083)
 *
 * What an operator surface needs to draw a bundle line with its components
 * indented under it: which commercial line is a bundle, the version it was
 * frozen with, and the components with their quantities. Derived from the
 * order's frozen expansion, never from the live definition.
 *
 * @module libs/core/src/orders/domain/types
 */

export interface OrderBundleComponent {
  /** The physical line id: `{lineId}~c:{variantId}`. */
  lineId: string;
  variantId: string;
  productId: string;
  /** Units of this component for the WHOLE line (per-unit times the line quantity). */
  quantity: number;
  /** Units of this component in ONE bundle unit. */
  perUnit: number;
  giftSlot?: boolean;
}

export interface OrderBundleLine {
  /** The commercial line id (what the buyer paid for). */
  lineId: string;
  bundleVariantId: string;
  /** The definition version this order was frozen with. */
  version: number;
  components: OrderBundleComponent[];
}

/** A raw channel line sold as several units of one product, read before it is resolved. */
export interface RawMultipackLine {
  itemId: string;
  name: string | null;
  packQuantity: number;
  productRef: { type: 'offer' | 'variant' | 'product' | 'sku'; externalId: string };
}
