/**
 * Promotion Application Service Interface (#3935)
 *
 * Applies promotions to an order at ingestion and previews what they would do.
 * The order is not a type here: the caller projects its own order onto facts and
 * plan lines and writes the resulting lines itself, so promotions never import
 * `orders`. Stock is likewise an argument (`readStock`), because the availability
 * read belongs to `inventory`.
 *
 * @module libs/core/src/promotions/application/interfaces
 */
import type { Promotion } from '../../domain/entities/promotion.entity';
import type { PromotionEvaluation } from '../../domain/domain-services/evaluate-promotions';
import type {
  PromotionOutcome,
  PromotionStockAnswer,
} from '../../domain/types/promotion-application.types';
import type { PromotionOrderFacts, PromotionPlanLine } from '../../domain/types/promotion-facts.types';

/** The benefit's supply per variant; a variant missing from the map is read as unknown. */
export type PromotionStockReader = (
  variantIds: readonly string[],
) => Promise<ReadonlyMap<string, PromotionStockAnswer>>;

export interface ApplyPromotionsInput {
  readonly facts: PromotionOrderFacts;
  readonly lines: readonly PromotionPlanLine[];
  readonly componentProductIds?: ReadonlySet<string>;
  /** The resolved OpenLinker customer; `null` when identity resolution produced none. */
  readonly customerId: string | null;
  /** Promotions whose gift line is already on the order (the overlay key is present). */
  readonly presentPromotionIds: ReadonlySet<string>;
  readonly readStock: PromotionStockReader;
  /** Only the first ingestion logs non-applications; a re-poll would repeat them. */
  readonly isFirstIngestion: boolean;
}

/** A line the caller must write: the benefit as granted, frozen from the grant. */
export interface PromotionLineGrant {
  readonly promotion: Promotion;
  readonly productId: string;
  readonly variantId: string;
  readonly documentForm: string | null;
  readonly quantity: number;
  /** `new` = granted by this call; `self-heal` = granted earlier but the line is missing. */
  readonly origin: 'new' | 'self-heal';
}

export interface ApplyPromotionsResult {
  readonly outcomes: readonly PromotionOutcome[];
  readonly lineGrants: readonly PromotionLineGrant[];
  /** Every promotion that was in play, for failure reporting by the caller. */
  readonly promotions: readonly Promotion[];
}

export interface PreviewPromotionsInput {
  readonly facts: PromotionOrderFacts;
  readonly lines: readonly PromotionPlanLine[];
  readonly componentProductIds?: ReadonlySet<string>;
  readonly customerId: string | null;
  readonly readStock: PromotionStockReader;
  /** An unsaved promotion evaluated beside the saved ones. */
  readonly draft?: Promotion;
}

export interface PreviewPromotionsResult {
  readonly evaluatedAt: Date;
  readonly evaluations: readonly PromotionEvaluation[];
  readonly outcomes: readonly PromotionOutcome[];
}

export interface IPromotionApplicationService {
  /**
   * Decide and record. Reads the ledger, plans and writes the grants and state
   * changes under one lock per candidate promotion; the GRANT is written before
   * the caller writes the line, so a crash leaves "granted, line missing" (which
   * self-heals), never "line present, ungranted". Throws on infrastructure
   * failure: the caller is fail-open and reports through `recordFailure`.
   */
  apply(input: ApplyPromotionsInput): Promise<ApplyPromotionsResult>;

  /** What the promotions would do. Writes nothing and waives the retroactivity floor. */
  preview(input: PreviewPromotionsInput): Promise<PreviewPromotionsResult>;

  /** Record that the promotions in play could not be applied (fail-open must not be silent). */
  recordFailure(
    promotions: readonly Pick<Promotion, 'id' | 'name'>[],
    internalOrderId: string,
    message: string,
  ): Promise<void>;

  /** Return a cancelled order's units to the caps and limits; returns the rows removed. */
  releaseForOrder(internalOrderId: string): Promise<number>;
}
