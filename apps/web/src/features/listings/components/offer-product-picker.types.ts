/**
 * OfferProductPickerModal shared types
 *
 * Types shared across the picker modal, its row and rail sub-components, and
 * the pure selector helpers in `../lib/offer-product-picker-selectors.ts`
 * (#1819 extraction). Component-local prop interfaces stay inline in their
 * own component file; only cross-file shapes live here.
 *
 * @module apps/web/src/features/listings/components
 */

/** Max distinct products per batch (mirrors the `/products` BULK_SELECTION_CAP,
 *  kept local per R1 to avoid a `features -> pages` import). */
export const OFFER_PICKER_PRODUCT_CAP = 100;

/** Per-product selection: whole product, or an explicit variant subset. */
export type SelectionEntry = 'ALL' | Set<string>;

/** Two-step wizard step (meaningful only <=1023px; desktop shows both regions). */
export type PickerStep = 'products' | 'review';

/** Derived per-product row for the selection rail. */
export interface RailGroup {
  productId: string;
  name: string;
  imageSrc: string | null;
  whole: boolean;
  totalVariants: number;
  /**
   * Barcode readiness for a whole-product pick, derived from loaded variant
   * metadata; `null` for a subset pick (which shows per-variant chips instead).
   * `loaded: false` means the product's variants have not been fetched yet, so
   * the chip must read "not checked" rather than a confident "ready".
   */
  wholeEan: { loaded: boolean; needCount: number } | null;
  /** Selected variants for a subset pick; `null` for a whole-product pick. */
  selected: { id: string; label: string; hasBarcode: boolean }[] | null;
}
