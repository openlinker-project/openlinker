/**
 * Routing dry-run transport types (#2954)
 *
 * The frontend view of `POST /connections/:connectionId/sourcing-rules/dry-run`.
 * `reason` on an unfulfillable line and every rule `displayLabel` are the
 * router's own words and are rendered verbatim: this module declares no reason
 * or rule-name vocabulary, so there is nothing here to drift from the engine.
 *
 * @module apps/web/src/features/oms/api
 */

export interface DryRunBasketLine {
  productVariantId: string;
  quantity: number;
}

export interface DryRunBasket {
  lines: DryRunBasketLine[];
  countryIso2: string;
  postalCode?: string;
  deliveryMethod?: string;
}

/** An unsaved rule, in the saved rule's own shape. */
export interface DraftRule {
  id: string;
  position: number;
  kind: string;
  name: string;
  afterAction: string;
  priorityLocationIds?: string[];
}

/** Exactly one of `orderId` / `basket`. */
export interface RoutingDryRunRequest {
  orderId?: string;
  basket?: DryRunBasket;
  draftRules?: DraftRule[];
}

export interface RoutingAssignment {
  orderLineId: string;
  locationId: string | null;
  connectionId: string | null;
  deliveryMethod: string | null;
  quantity: number;
}

export interface RoutingUnfulfillableLine {
  orderLineId: string;
  quantity: number;
  resolution: 'refund' | 'return';
  /** The router's own string. Render verbatim. */
  reason: string;
}

export interface RoutingExplanationStep {
  rule: { ruleId: string; name: string; displayLabel: string };
  eliminated: string[];
  score: number | null;
  detail: string | null;
}

export interface RoutingEvaluation {
  candidates: RoutingAssignment[];
  unfulfillable: RoutingUnfulfillableLine[];
  explanation: RoutingExplanationStep[];
}

export interface RoutingLineChange {
  orderLineId: string;
  saved: string[];
  draft: string[];
}

export interface RoutingDryRunResult {
  input: {
    lines: Array<{ orderLineId: string; productVariantId: string; quantity: number }>;
    shipTo: {
      mode: string;
      countryIso2: string;
      postalCode?: string | null;
      city?: string | null;
      locationHash?: string | null;
    };
    requestedDeliveryMethod: string | null;
  };
  saved: RoutingEvaluation;
  draft?: RoutingEvaluation;
  changedLines?: RoutingLineChange[];
  /** Why live routing would not route this order; `null` when it would. */
  routingSkipReason: string | null;
}
