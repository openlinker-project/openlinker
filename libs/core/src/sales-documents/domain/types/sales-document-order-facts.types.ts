/**
 * Sales-Document Order-Fact Projection (#2170, ADR-041 decision 5)
 *
 * The pure rule evaluator (`evaluateSalesDocumentRules`) takes THIS shape as
 * its order input — never the raw `Order` entity, and never an injected
 * `orders`/`customers` service. A "projection" here is deliberate: today
 * `Order` carries no buyer-tax-id / buyer-type field at all (ADR-041 decision 5
 * itself: "a buyer tax-id / buyer-type on the order contract is a blocking
 * prerequisite of the engine, not an assumption it may make"), so the
 * evaluator's input type must not silently imply that field already exists on
 * `Order`. A future caller builds this projection from whatever it has in
 * hand — `buyerHasTaxId` is `boolean | undefined` (not defaulted) for exactly
 * that reason: `undefined` means "not asserted by the source" (today, always
 * — see `AutoIssueTriggerService`'s order-facts mapper, #2173), which is a
 * DIFFERENT fact from "known to have no tax id" (`false`). A caller must never
 * collapse the two by defaulting to `false`, since that would let a
 * `buyerHasTaxId` condition silently misfire (a false "no tax id" match) on
 * exactly the orders this gap is honest about not knowing. `undefined`
 * compares unequal to both `true` and `false` in `evaluateCondition`, so an
 * unknown fact never matches either literal — never throws, never coerces to
 * a guess.
 *
 * Dependency-free leaf file (no imports) — matches every other file in this
 * concern.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import type {
  SalesDocumentCondition,
  SalesDocumentThresholdComparisonOp,
} from './sales-document-condition.types';

/**
 * How the order's own monetary amounts express tax — mirrors
 * `PriceTaxTreatment` (`@openlinker/core/orders/types`) VALUE-IDENTICALLY but
 * is declared independently here rather than imported, since a type-only
 * import from that sub-barrel is reserved for the one authorized `Order`
 * exception already pinned by the barrel-purity spec (#2155) and this
 * projection must not grow a second reason to touch it.
 */
export const SalesDocumentOrderTaxTreatmentValues = ['inclusive', 'exclusive'] as const;
export type SalesDocumentOrderTaxTreatment = (typeof SalesDocumentOrderTaxTreatmentValues)[number];

/**
 * The reduced set of order facts a rule may condition on — the caller-built
 * projection the evaluator reads as a value parameter.
 */
export interface SalesDocumentOrderFacts {
  /** Delivery country, ISO 3166-1 alpha-2 (ADR-041 decision 5's own choice of address). */
  readonly country: string;
  /** The order's gross (tax-inclusive) total, in `currency`. */
  readonly totalGross: number;
  /** ISO-4217 currency of `totalGross`. */
  readonly currency: string;
  /**
   * Absent means "not asserted by the source" — mirrors `OrderTotals.taxTreatment`.
   * A missing/`exclusive` treatment makes any `orderTotalGross` condition
   * evaluate to the terminal `net-priced-order` signal rather than a guess
   * (ADR-041 decision 5).
   */
  readonly taxTreatment?: SalesDocumentOrderTaxTreatment;
  /**
   * Whether the buyer carries a tax identifier. Blocked prerequisite (see the
   * module doc comment): `undefined` means "unknown" and is what every caller
   * in this repo passes until a buyer-tax-id field lands on the order
   * contract — never defaulted to `false`.
   */
  readonly buyerHasTaxId: boolean | undefined;
}

/** One rule, reduced to what the evaluator needs (mirrors `SalesDocumentRoutingCandidate`'s reduction style). */
export interface SalesDocumentRuleFact {
  readonly id: string;
  readonly conditions: readonly SalesDocumentCondition[];
  readonly documentKind: string;
  readonly connectionId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/** One country (or `*`) default, reduced to what the evaluator needs. */
export interface SalesDocumentCountryDefaultFact {
  readonly documentKind: string;
  readonly connectionId: string;
}

/** One threshold ("regime pack" row), reduced to what the evaluator needs. */
export interface SalesDocumentThresholdFact {
  readonly ref: string;
  readonly amount: number;
  readonly currency: string;
  readonly comparisonOp: SalesDocumentThresholdComparisonOp;
}

/** The pseudo-country code for the "Rest of world" catch-all scope. */
export const SALES_DOCUMENT_REST_OF_WORLD_COUNTRY = '*';
