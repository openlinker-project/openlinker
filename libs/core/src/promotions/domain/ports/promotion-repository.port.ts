/**
 * Promotion Repository Port (#3935)
 *
 * Persistence of promotion DEFINITIONS. What a promotion has done (state, grants,
 * the application log) lives behind the ledger and log ports.
 *
 * @module libs/core/src/promotions/domain/ports
 */
import type { Promotion } from '../entities/promotion.entity';
import type { PromotionBenefit } from '../types/promotion-benefit.types';
import type { PromotionCombination } from '../types/promotion-combination.types';
import type { PromotionCondition } from '../types/promotion-condition.types';
import type { PromotionLimits } from '../types/promotion-limits.types';

export interface PromotionPersistInput {
  readonly name: string;
  readonly isActive: boolean;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly conditions: readonly PromotionCondition[];
  readonly benefit: PromotionBenefit;
  readonly combinesWith: PromotionCombination;
  readonly limits: PromotionLimits;
  readonly definitionHash: string;
}

export interface PromotionRepositoryPort {
  findById(id: string): Promise<Promotion | null>;
  /** Every promotion in list order (position, then creation time). */
  findAllOrdered(): Promise<Promotion[]>;
  findByDefinitionHash(definitionHash: string): Promise<Promotion[]>;
  /** Appends at the end of the list. Throws `PromotionConflictError` on the unique (hash, effectiveFrom) violation. */
  create(input: PromotionPersistInput): Promise<Promotion>;
  /** Keeps position and identity; throws `PromotionNotFoundError` / `PromotionConflictError`. */
  update(id: string, input: PromotionPersistInput): Promise<Promotion>;
  /**
   * Deletes the promotion and, in the same transaction, removes its id from every other
   * promotion's `selected` combination list (re-hashing those that change).
   */
  delete(id: string): Promise<void>;
  /** Stamp positions 1..N in the given order, in one statement. */
  setPositions(orderedIds: readonly string[]): Promise<void>;
}
