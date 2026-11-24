/**
 * Promotion Ledger Port (#3935)
 *
 * Persistence of what promotions have DONE: the per-promotion state (pause,
 * raised cap) and the grant ledger (one row per promotion per order). Written by
 * the ingestion path, read by the list; neither is part of a definition.
 *
 * @module libs/core/src/promotions/domain/ports
 */
import type {
  PromotionGrant,
  PromotionPauseReason,
  PromotionState,
} from '../types/promotion-application.types';

export interface PromotionLedgerPort {
  /**
   * Run `work` while holding a transaction-scoped advisory lock per promotion id
   * (taken in sorted order, so two callers cannot deadlock). It serialises the
   * read-sum-then-insert-grant of two concurrent ingestions, which is what stops
   * them overshooting a unit cap or a customer limit.
   */
  withPromotionsLocked<T>(promotionIds: readonly string[], work: () => Promise<T>): Promise<T>;

  findStates(promotionIds: readonly string[]): Promise<Map<string, PromotionState>>;
  /** Total units given per promotion; one that gave nothing is absent. */
  sumUnitsGiven(promotionIds: readonly string[]): Promise<Map<string, number>>;
  sumUnitsForCustomer(
    promotionIds: readonly string[],
    customerId: string,
  ): Promise<Map<string, number>>;
  findGrantsForOrder(internalOrderId: string): Promise<PromotionGrant[]>;

  /** `true` when this call wrote the grant, `false` when the pair already had one. */
  recordGrant(grant: Omit<PromotionGrant, 'createdAt'>): Promise<boolean>;

  /** Delete every grant of a cancelled order so its units return to the cap and the limit. Idempotent. */
  releaseGrantsForOrder(internalOrderId: string): Promise<number>;

  /**
   * Units granted for these variants whose order has not reserved yet and whose
   * grant is newer than `notOlderThan`, leaving `excludeOrderId` out. The
   * availability read cannot see them.
   */
  sumPendingUnitsForVariants(
    variantIds: readonly string[],
    excludeOrderId: string | null,
    notOlderThan: Date,
  ): Promise<Map<string, number>>;

  /** Set (`reason`) or clear (`null`) the pause, creating the state row if needed. */
  setPause(promotionId: string, reason: PromotionPauseReason | null): Promise<void>;

  /** Raise the cap by `extraUnits` and clear a `unit-cap` pause; a stock pause is left alone. */
  extendCap(promotionId: string, extraUnits: number): Promise<void>;
}
