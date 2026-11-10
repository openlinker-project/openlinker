/**
 * Order Gift Service Interface (#3938)
 *
 * Applies OpenLinker promotions to an order at ingestion, and previews what they
 * would do to a stored order without writing anything.
 *
 * @module libs/core/src/orders/application/services
 */
import type {
  Promotion,
  PromotionEvaluation,
  PromotionOutcome,
} from '@openlinker/core/promotions';

import type { BundleDefinition } from '@openlinker/core/products';

import type { OrderRecord } from '../../domain/entities/order-record.entity';
import type { Order } from '../../domain/types/order.types';
import type { OrderEdits } from '../../domain/types/order-edits.types';

export interface ApplyGiftRulesInput {
  /** The order as ingestion holds it AFTER the overlay was applied. */
  readonly order: Order;
  /** The channel's own order, from which the overlay is re-applied after a gift is added. */
  readonly channelOrder: Order;
  /** The overlay committed by this very ingestion's upsert. */
  readonly edits: OrderEdits | null;
  /** The resolved OpenLinker customer; `null` when identity resolution produced none. */
  readonly customerId: string | null;
  readonly sourceConnectionId: string;
  /**
   * When the order was placed, for the retroactivity floor (R4). The caller falls
   * back to the record's first-seen instant, then to now, for a source that
   * reports no placement time - never to a value that predates the order.
   */
  readonly occurredAt: Date;
  /**
   * The bundle definitions already frozen on the order's record, when it has one
   * (a re-ingestion). Absent on a first ingestion, where the components are
   * resolved from the live definitions exactly as the freeze will.
   */
  readonly frozenDefinitions?: readonly BundleDefinition[];
  /**
   * Whether NEW grants may be written. `true` only while the order is
   * pre-routing and pre-mirror (a first ingestion, or a re-ingestion before any
   * destination order or frozen line expansion exists): a gift line added later
   * would never be picked, decremented or mirrored. The caller decides, because
   * it holds the prior record.
   */
  readonly allowNewGrants: boolean;
  /**
   * The order is already known cancelled (consumed early signal, or the record's
   * `cancelledAt`) while `order.status` may still lag: no gift is given.
   */
  readonly cancelled?: boolean;
  /** Only the first ingestion records non-applications; a re-poll would repeat them. */
  readonly isFirstIngestion: boolean;
}

export interface ApplyGiftRulesResult {
  /** The order with every gift line merged; the very `order` argument when nothing was added. */
  readonly order: Order;
  readonly outcomes: readonly PromotionOutcome[];
}

export interface GiftPreviewInput {
  readonly record: OrderRecord;
  /** A promotion not yet saved, evaluated beside the saved ones. */
  readonly draft?: Promotion;
}

export interface GiftPreviewResult {
  readonly evaluatedAt: Date;
  readonly evaluations: readonly PromotionEvaluation[];
  readonly outcomes: readonly PromotionOutcome[];
}

export interface IOrderGiftService {
  /**
   * Evaluate the gift rules and write the gifts into the order overlay. Never
   * throws: a failure here must not cost the order its ingestion, so it logs and
   * returns the order unchanged (a re-ingestion retries it).
   */
  applyGiftRules(input: ApplyGiftRulesInput): Promise<ApplyGiftRulesResult>;

  /**
   * What the rules would do to a stored order. Writes nothing - no gift, no
   * ledger row, no pause - and waives the retroactivity floor so an operator can
   * test a rule against any order.
   */
  /**
   * Release a cancelled order's gift grants so the units return to the rules'
   * caps and customer limits. Never throws; idempotent.
   */
  releaseGrantsForCancelledOrder(internalOrderId: string): Promise<void>;

  previewForOrder(input: GiftPreviewInput): Promise<GiftPreviewResult>;
}
