/**
 * Master Product Sync Service Interface
 *
 * Core-owned orchestration for pulling product data from a master system (e.g., PrestaShop)
 * via ProductMasterPort and upserting into canonical storage.
 *
 * @module libs/core/src/products/application/services
 */

export interface MasterProductSyncResult {
  internalProductId: string;
  variantsUpserted: number;
  /**
   * True when the product was found deleted at the master (neutral
   * `MasterProductNotFoundError`) — all its variants were marked stale and no
   * upsert ran (#1599). The worker handler maps this to a terminal
   * `outcome: 'business_failure'` (ADR-007) instead of a retryable throw.
   */
  masterDeleted: boolean;
  /**
   * True when the staleness prune was SKIPPED because another connection with
   * `ProductMaster` enabled also claims this internal product id (#1904).
   * Pruning is keyed on the internal product id alone - with two capable
   * claimants it cannot be attributed, so it is withheld rather than staling
   * rows a sibling connection still considers live. Upserts still ran; no
   * `master.*.stale` event was emitted.
   */
  pruneSkipped: boolean;
  /**
   * Why the staleness prune did not run, when it did not.
   *
   * Distinct from `pruneSkipped` on purpose: that flag means RIVAL-BLOCKED and
   * is documented and logged with exactly that meaning, so overloading it with
   * the zero-variant skip would leave an operator unable to tell a #1904
   * collision from a flaky master response - two conditions with completely
   * different remediations. `'empty-response'` therefore reports a skip that
   * leaves `pruneSkipped` false.
   */
  pruneSkippedReason: PruneSkippedReason;
  /**
   * Variants whose EFFECTIVE tax rate the shop just changed (#2263, ADR-063).
   *
   * Reported rather than acted on: propagating a rate onto a live offer is an
   * outbound marketplace write, and enqueueing it is the worker handler's job,
   * not this service's - the `products` context has no edge to `sync` and
   * gaining one to schedule an offer write would invert the direction the
   * offer-side already owns.
   *
   * Three properties matter to a consumer. It reports a **change**, never a
   * read: the entries come from the journal's own change-only rule (#2250), so
   * a twenty-minute sweep over an unchanged catalogue reports an empty array
   * and enqueues nothing. It is **per variant and already effective**, because
   * offers are variant-keyed and a product-level change reaches every variant
   * that carries no override of its own (`effectiveTaxRate`). And it names only
   * a **known** rate - a rate the shop cleared, or never had, is never
   * propagated, because "the shop does not know" is not a value a channel can
   * be told.
   */
  taxRateChanges: readonly MasterTaxRateChange[];
}

/** One variant whose effective rate moved, as the sync observed it (#2263). */
export interface MasterTaxRateChange {
  variantId: string;
  /** The neutral percent-as-string code now in force. Never null - see above. */
  taxRate: string;
}

/**
 * `'rival'`  - another connection with `ProductMaster` enabled claims this
 *              internal id, so the connection-blind prune was withheld (#1904).
 * `'empty-response'` - the master returned zero variants for an existing
 *              product; pruning against an empty keep-set would stale every
 *              variant on what may be a transient response (#1599).
 */
export const PruneSkippedReasonValues = ['rival', 'empty-response'] as const;

/** `null` is carried at the field rather than in the union, so the runtime array above stays a list of real reasons. */
export type PruneSkippedReason = (typeof PruneSkippedReasonValues)[number] | null;

export interface IMasterProductSyncService {
  syncFromMasterByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<MasterProductSyncResult>;

  /**
   * Record that a master has confirmed this product is gone: mark every one of
   * its variants stale, emit `master.product.stale`, honouring the #1904
   * rival-claimant guard.
   *
   * Public so the INVENTORY context can route its own confirmed deletion
   * through this one authority (#2222). Before that, the inventory path staled
   * `inventory_items` only, while `StaleOfferPauseService` re-verifies
   * `product_variants` - so the whole #1689 chain fired and then paused
   * nothing, and a deleted product's offers kept selling. Two writers to
   * `isStale` would each need their own copy of the rival guard and the
   * event gate, and would drift; the products context stays the single owner
   * of `product_variants`.
   *
   * The caller must have an AUTHORITATIVE deletion signal - a platform 404
   * surfaced as `MasterProductNotFoundError`. Never call this on inference
   * from absence: catalog enumeration is unordered offset paging on both
   * shipped masters, so a live product can be missed by a page (ADR-048's
   * #2222 amendment).
   */
  markProductDeletedAtMaster(input: {
    connectionId: string;
    externalId: string;
    internalProductId: string;
    correlationId: string;
  }): Promise<MasterProductSyncResult>;
}

