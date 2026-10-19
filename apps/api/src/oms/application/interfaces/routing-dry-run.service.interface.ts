/**
 * Routing Dry-Run Service Interface (#2954)
 *
 * The API-layer contract for "where would this order go?" - a non-committing
 * evaluation of the OL fulfilment router, optionally compared against an
 * unsaved draft ruleset. Nothing it does is persisted.
 *
 * @module apps/api/src/oms/application/interfaces
 * @see {@link RoutingDryRunService} for the implementation
 */
import type { RoutingEvaluation, RoutingInput } from '@openlinker/core/fulfillment';
import type { RoutingLineChange } from '@openlinker/oms';

export const ROUTING_DRY_RUN_SERVICE_TOKEN = Symbol('IRoutingDryRunService');

/** A hand-built hypothetical order: only what the router is allowed to see. */
export interface DryRunBasket {
  readonly lines: ReadonlyArray<{ readonly productVariantId: string; readonly quantity: number }>;
  readonly countryIso2: string;
  readonly postalCode?: string;
  readonly deliveryMethod?: string;
}

/** Exactly one of an existing order or a basket. */
export type DryRunSubject =
  | { readonly orderId: string; readonly basket?: undefined }
  | { readonly basket: DryRunBasket; readonly orderId?: undefined };

/** An unsaved rule, in the saved rule's own shape (`id` is whatever the caller labels it with). */
export interface DraftRuleInput {
  readonly id: string;
  readonly position: number;
  readonly kind: string;
  readonly name: string;
  readonly afterAction: string;
  readonly priorityLocationIds?: readonly string[];
}

export interface DryRunRequest {
  readonly subject: DryRunSubject;
  readonly draftRules?: readonly DraftRuleInput[];
}

export interface DryRunResult {
  /** Exactly what the router was told - the ADR-062 allowlist, shown to the operator. */
  readonly input: Pick<RoutingInput, 'lines' | 'shipTo' | 'requestedDeliveryMethod'>;
  readonly saved: RoutingEvaluation;
  /** Present only when `draftRules` was supplied. */
  readonly draft?: RoutingEvaluation;
  /** Present only when `draftRules` was supplied: the lines the draft places differently. */
  readonly changedLines?: readonly RoutingLineChange[];
}

export interface IRoutingDryRunService {
  /**
   * Evaluate (never route). Raises 404 for an unknown order / connection and 400
   * for a non-OMS connection, a missing router, an order that is not fully
   * ingested or has no shipping address, or a draft the router could not evaluate
   * (an unroutable rule, or a repeated rule id).
   */
  dryRun(connectionId: string, request: DryRunRequest): Promise<DryRunResult>;
}
