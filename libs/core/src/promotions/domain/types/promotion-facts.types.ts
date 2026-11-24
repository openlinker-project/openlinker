/**
 * Promotion Order Facts (#3935)
 *
 * What the promotions context knows about the order it is asked about. A plain
 * type handed in as an ARGUMENT: promotions imports nothing from `orders`, so the
 * caller projects its own order onto this shape. Every field is optional and an
 * absent one means UNKNOWN, never false - a condition over an unasserted fact
 * reads `unknown` so an operator is told "we could not tell".
 *
 * @module libs/core/src/promotions/domain/types
 */
export interface PromotionOrderFacts {
  readonly orderId: string;
  /** When the order was placed; the retroactivity floor compares it to the promotion's creation. */
  readonly occurredAt?: Date;
  readonly sourceConnectionId?: string;
  /** Delivery country (ISO alpha-2). */
  readonly country?: string;
  readonly totalGross?: number;
  readonly currency?: string;
  /** Product / variant ids of the buyer's own lines; gift lines are excluded by the caller. */
  readonly lineProductIds?: readonly string[];
  readonly lineVariantIds?: readonly string[];
}

/** One order line as the planner reads it. */
export interface PromotionPlanLine {
  readonly productId: string;
  readonly variantId?: string;
  readonly quantity: number;
  /** A gift line already on the order never counts toward a purchase condition. */
  readonly isGift: boolean;
}
