/**
 * Promotion Application Log Port (#3935)
 *
 * The append-only record of what happened when a promotion was applied to an
 * order, so a skipped or failed application is never silent. Replaces the
 * `automation_runs` rows gift rules used to write; the promotion name is frozen
 * on the row so history survives a rename or delete.
 *
 * @module libs/core/src/promotions/domain/ports
 */
import type {
  PromotionApplicationOutcome,
  PromotionApplicationRecord,
} from '../types/promotion-application.types';

export interface AppendPromotionApplication {
  readonly promotionId: string;
  readonly promotionName: string;
  readonly internalOrderId: string;
  readonly outcome: PromotionApplicationOutcome;
  readonly reason: string | null;
  readonly quantity: number;
  readonly message: string | null;
}

export interface PromotionApplicationLogPort {
  append(entries: readonly AppendPromotionApplication[]): Promise<void>;
  findByOrder(internalOrderId: string, limit: number): Promise<PromotionApplicationRecord[]>;
  findByPromotion(promotionId: string, limit: number): Promise<PromotionApplicationRecord[]>;
  findById(id: string): Promise<PromotionApplicationRecord | null>;
  /** Mark a record handled by a person; the record itself is unchanged. `null` when absent. */
  dismiss(id: string, userId: string, at: Date): Promise<PromotionApplicationRecord | null>;
}
