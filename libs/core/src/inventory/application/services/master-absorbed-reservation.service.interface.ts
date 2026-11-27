/**
 * Master-Absorbed Reservation Service Interface
 *
 * The contract `OrderSyncService` calls once an order has been created at a
 * destination connection: *"this connection now holds the order - consume the
 * holds that sit on its own stock."*
 *
 * Why it exists: when the destination that received the order is ALSO the
 * product master that owns the reserved position (one shop playing both roles,
 * which PrestaShop, WooCommerce and Shoper all do), creating the order lowers
 * that master's stock in its own order flow. From that moment the reduction is
 * in `availableQuantity`, so a `published` hold for the same units would
 * subtract them a second time from what marketplaces are told - until the
 * dispatch consume (#2347), which can be days later.
 *
 * The premise is per shop, not universal: a shop configured not to subtract
 * stock on purchase never removed the units. So `OrderSyncService` calls this
 * only for a destination that DECLARES the create lowered its stock (the
 * `OrderCreateStockEffect` capability, probed, never assumed); every other
 * destination keeps its holds until dispatch. Shoper declares it from its own
 * `shopping_update_stock_on_buy` setting; PrestaShop and WooCommerce do not
 * declare it yet, so their holds stay until dispatch as before this service.
 *
 * @module libs/core/src/inventory/application/services
 * @see {@link MasterAbsorbedReservationService} for the implementation
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */

/** Which order, which master, and whether to republish now. */
export interface ConsumeAbsorbedHoldsInput {
  readonly orderRecordId: string;
  /**
   * The destination connection the order was created at, which has declared
   * that the create lowered its stock. A hold is consumed only when its
   * position's `sourceConnectionId` is exactly this id.
   */
  readonly masterConnectionId: string;
  /**
   * The order's internal product ids. Scopes the position read; a hold whose
   * position is not among them is kept (it is reported, never guessed at).
   */
  readonly productIds: readonly string[];
  /**
   * Enqueue `inventory.propagateToMarketplaces` for the variants whose holds
   * this call closed.
   *
   * The caller passes `false` when it has just created the order and is about
   * to enqueue the post-sale master re-read: that re-read writes the master's
   * lowered number through `setInventory`, which propagates with the hold
   * already gone. Propagating here as well could run first and publish the
   * master's PRE-sale number for the moment until the re-read lands. `true` is
   * for an order created on an earlier run, whose post-sale re-read already ran
   * and will not run again, so nothing else would republish.
   */
  readonly propagate: boolean;
}

/**
 * What the call did. Every kept hold is counted by reason, so a hold left in
 * place is a visible number rather than a silent no-op.
 */
export interface ConsumeAbsorbedHoldsResult {
  /** Holds moved `held -> consumed` by this call. */
  readonly closed: number;
  /** Holds a peer closed between the read and the close - benign. */
  readonly alreadyTerminal: number;
  /** Holds whose close failed; they still stand. */
  readonly failed: number;
  /** Kept: the position's owner is `NULL` / `'legacy'`, so it cannot be named. */
  readonly keptUnattributed: number;
  /** Kept: the position belongs to a different master, which did not see the order. */
  readonly keptOtherOwner: number;
  /** Kept: the position is no longer live (stale) or was not among the product ids. */
  readonly keptUnknownPosition: number;
  /** Kept: a `diagnostic` hold, which subtracts nothing from published ATP. */
  readonly keptDiagnostic: number;
  /**
   * Kept: this master's hold shares its order line with a hold that must stay.
   * The close is line-scoped, so closing one would close both.
   */
  readonly keptSharedLine: number;
  /** Propagation jobs enqueued (one per distinct variant). */
  readonly propagationsEnqueued: number;
}

export interface IMasterAbsorbedReservationService {
  /**
   * Consume (`held -> consumed`) every `published` hold of the order whose
   * position is owned by `masterConnectionId`, through
   * `IReservationService.closeForOrder`.
   *
   * Idempotent: a repeat finds no held rows and closes nothing, and a line
   * already consumed is never re-held, because `reserveForOrder` skips a line
   * carrying a terminal row (`already-closed`, #2344).
   *
   * Read failures propagate to the caller; a failed propagation enqueue is
   * logged and swallowed, because the close is already durable and the master
   * sweep republishes from persisted state.
   */
  consumeAbsorbedHolds(input: ConsumeAbsorbedHoldsInput): Promise<ConsumeAbsorbedHoldsResult>;
}
