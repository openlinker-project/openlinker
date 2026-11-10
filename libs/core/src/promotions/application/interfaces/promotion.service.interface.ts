/**
 * Promotion Service Interface (#3935)
 *
 * The operator-facing seam over promotion definitions: list (with each
 * promotion's state and what it has given), CRUD, reorder, and the explicit
 * resume after a unit cap. Applying promotions to an order is
 * `IPromotionApplicationService`.
 *
 * @module libs/core/src/promotions/application/interfaces
 */
import type { Promotion } from '../../domain/entities/promotion.entity';
import type { PromotionState } from '../../domain/types/promotion-application.types';

/** Id carried by an unsaved draft evaluated beside the saved promotions. */
export const PROMOTION_DRAFT_ID = '00000000-0000-0000-0000-000000000000';

/** The untrusted write input; every member is narrowed on the way in. */
export interface PromotionInput {
  readonly name: string;
  /** Fails closed: omitted means inactive. */
  readonly isActive?: boolean;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly conditions: readonly unknown[];
  readonly benefit: unknown;
  /** Omitted means `{ mode: 'all' }`. Untrusted: narrowed and validated on the way in. */
  readonly combinesWith?: unknown;
  readonly limits?: { readonly unitCap?: number | null; readonly customerLimit?: number | null };
}

export interface PromotionView {
  readonly promotion: Promotion;
  readonly state: PromotionState | null;
  readonly unitsGiven: number;
  /** `unitCap + capExtension`, or `null` when there is no cap. */
  readonly effectiveCap: number | null;
}

export interface IPromotionService {
  /** Every promotion in list order. */
  list(): Promise<PromotionView[]>;
  /** Throws `PromotionNotFoundError`. */
  get(id: string): Promise<PromotionView>;
  /** Throws `PromotionInvalidError` / `PromotionConflictError`. */
  create(input: PromotionInput): Promise<PromotionView>;
  /** A full replace; keeps list position, ledger and pause state. */
  update(id: string, input: PromotionInput): Promise<PromotionView>;
  delete(id: string): Promise<void>;
  /** Exhaustive: must name every promotion once, or `PromotionReorderMismatchError`. */
  reorder(orderedIds: readonly string[]): Promise<PromotionView[]>;
  /** The explicit resume of a promotion paused at its unit cap. */
  resumeAfterCap(id: string, additionalUnits: number): Promise<PromotionView>;
  /** Narrow an input into an unsaved `Promotion` (id `PROMOTION_DRAFT_ID`) for a dry run; writes nothing. */
  buildDraft(input: PromotionInput): Promotion;
}
