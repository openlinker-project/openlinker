/**
 * Price Change Observer Port (#3143, ADR-072)
 *
 * `products` reports a master catalog price change; it never DECIDES what to
 * do about it. Recurring price propagation (episode detection, currency
 * blocking, automatic-mode bypass) lives entirely in `listings`
 * (`PriceChangeDetectionService`) — but `listings` already imports
 * `ProductsModule` (per-variant master stock, #824), so `products` may not
 * import `listings` back without closing a module-load cycle.
 *
 * The observer is therefore OPTIONAL and injected as `@Optional()` by
 * `MasterProductSyncService`: `ProductsModule` binds nothing, so a host that
 * never wires an implementation degrades to "no price-change detection",
 * never a boot failure. The real binding happens host-side, in a `@Global()`
 * module that imports `ListingsModule` and rebinds this token to
 * `PriceChangeDetectionService` — the same "port owned by the caller,
 * implementation bound at the composition root" shape
 * `FulfillmentRouterBindingModule` already uses for a `libs/core -> libs/oms`
 * edge, applied here to a same-package reverse-dependency edge instead.
 *
 * @module libs/core/src/products/domain/ports
 */

export interface MasterPriceChangeObservation {
  productVariantId: string;
  /** The connection this observation was pulled from (the master/source). */
  sourceConnectionId: string;
  /**
   * The variant's price BEFORE this sync pass, or `null` when no prior price
   * was ever recorded (a newly-mapped variant) — the caller then has no
   * baseline to diff against.
   */
  sourceOldAmount: number | null;
  sourceNewAmount: number;
  /** ISO 4217. From `Product.currency` — resolved by the master adapter. */
  sourceCurrency: string;
}

export interface PriceChangeObserverPort {
  /**
   * Best-effort. A throw here must never fail the catalogue sync it rides
   * along — the caller wraps every call and logs rather than propagates.
   */
  onMasterPriceChanged(observation: MasterPriceChangeObservation): Promise<void>;
}
