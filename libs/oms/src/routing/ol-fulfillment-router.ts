/**
 * The OpenLinker fulfilment router
 *
 * The first real implementer of `FulfillmentRouterPort` (#2408). It decides
 * which location sources which line, using a closed vocabulary of named filters
 * and sorts the operator sequences into an ordered ruleset.
 *
 * ## Not a dispatched capability
 *
 * `FulfillmentRouter` is deliberately absent from `CoreCapabilityValues` and
 * from every manifest (#2403 — authority A2 is `config-only`), so this router
 * is reached through a factory rather than `getCapabilityAdapter`. Advertising
 * it would invite a gate on `enabledCapabilities`, which is stamped at
 * connection create and never retro-filled, so the gate would silently drain
 * nothing for every connection that already exists (the #2085 shape).
 *
 * ## `evaluate()` and `route()` are the same computation
 *
 * Both call `evaluateRouting` and nothing else. `route()` adds only a decision
 * reference; it never re-decides. That is what makes their explanations
 * provably identical rather than merely similar, and it is why `evaluate()`
 * cannot leak a committing identifier — it has none to leak.
 *
 * @module libs/oms/src/routing
 */
import type {
  FulfillmentRouterPort,
  RouteOptions,
  RoutingEvaluation,
  RoutingInput,
  RoutingPlan,
} from '@openlinker/core/fulfillment';
import type { IFulfillmentWorkQueryService } from '@openlinker/core/fulfillment';
import type { IInventoryQueryService, ILocationService } from '@openlinker/core/inventory';

import { evaluateRouting } from './evaluate-routing';
import type { RoutingCandidate, RoutingFacts } from './routing-facts.types';
import { stockKey } from './routing-facts.types';
import type { RoutingRuleSourcePort } from './routing-rule-source.port';

const LOCATION_PAGE_SIZE = 200;
const INVENTORY_PAGE_SIZE = 500;

export interface OlFulfillmentRouterDeps {
  readonly connectionId: string;
  readonly rules: RoutingRuleSourcePort;
  readonly locations: ILocationService;
  readonly inventory: IInventoryQueryService;
  readonly works: IFulfillmentWorkQueryService;
  /** Injected so the pipeline stays a pure function of its inputs, clock included. */
  readonly now?: () => Date;
}

export class OlFulfillmentRouter implements FulfillmentRouterPort {
  constructor(private readonly deps: OlFulfillmentRouterDeps) {}

  async evaluate(input: RoutingInput): Promise<RoutingEvaluation> {
    const { rules, facts } = await this.load(input);
    const result = evaluateRouting(input, rules, facts);

    return {
      candidates: result.assignments,
      unfulfillable: result.unfulfillable,
      explanation: result.explanation,
    };
  }

  async route(input: RoutingInput, options: RouteOptions): Promise<RoutingPlan> {
    const { rules, facts } = await this.load(input);
    const result = evaluateRouting(input, rules, facts);

    return {
      status: 'resolved',
      // The router's OWN reference — the committer persists it as
      // `routerDecisionRef`, separate from its own decision row id. Derived
      // from the caller's idempotency key rather than minted, so a retry of a
      // crashed route reports a byte-identical reference.
      decisionId: `oms:${options.idempotencyKey}`,
      assignments: result.assignments,
      unfulfillable: result.unfulfillable,
      // Never emitted. `placeHold` is not transaction-composable, so Wave 3a's
      // committer refuses any plan carrying one (#2730).
      holds: [],
      explanation: result.explanation,
    };
  }

  private async load(
    input: RoutingInput
  ): Promise<{ rules: Awaited<ReturnType<RoutingRuleSourcePort['listActiveRules']>>; facts: RoutingFacts }> {
    const now = this.deps.now?.() ?? new Date();
    const rules = await this.deps.rules.listActiveRules(this.deps.connectionId, now);

    const candidates = await this.loadCandidates();
    const stock = await this.loadStock(input);
    const blockedConnectionIds = new Set<string>(
      await this.deps.works.listBlockingRejectionConnectionIds(input.orderId)
    );

    return { rules, facts: { candidates, stock, blockedConnectionIds } };
  }

  /**
   * Every active location, paged to exhaustion.
   *
   * Paged rather than capped on purpose: a candidate set silently truncated at
   * one page would route an order to the wrong place and report success, with
   * the omitted locations invisible everywhere.
   */
  private async loadCandidates(): Promise<readonly RoutingCandidate[]> {
    const candidates: RoutingCandidate[] = [];

    for (let page = 1; ; page += 1) {
      const result = await this.deps.locations.listLocations(
        { status: 'active' },
        { page, limit: LOCATION_PAGE_SIZE }
      );

      for (const location of result.items) {
        candidates.push({
          locationId: location.id,
          // The holder is THIS connection: OpenLinker's own OMS fulfils what it
          // routes. Deliberately not `location.ownerConnectionId`, whose
          // docblock records it as provenance and explicitly not authority —
          // and which is null for an operator-owned warehouse.
          //
          // The consequence is stated rather than left to be discovered:
          // because every candidate names the same holder,
          // `not-blocked-by-reject` is all-or-nothing here. If THIS connection
          // rejected the order with a blocking reason, every location is
          // eliminated and the order reports unfulfillable — which is the
          // correct reading of ADR-054 while OL is the only holder, and is why
          // the filter's elimination is real rather than decorative. It becomes
          // per-holder the moment a second fulfiller holds locations.
          connectionId: this.deps.connectionId,
          countryIso2: location.countryIso2,
          postcode: location.postcode,
        });
      }

      if (candidates.length >= result.total || result.items.length === 0) {
        return candidates;
      }
    }
  }

  /**
   * Available quantity per (location, variant), paged to exhaustion per variant.
   *
   * ## Rows are accumulated by their own id, never blindly summed
   *
   * `InventoryRepository.findMany` orders by `updatedAt DESC` with **no
   * tie-break**, and a bulk stock sync writes many rows in one statement — so
   * rows sharing a timestamp have no stable order and an offset read can return
   * the same row on two consecutive pages (ADR-048's "an unsorted offset read
   * has no tiling guarantee", reached from the other side). Summing there would
   * over-count available stock, and over-counted stock is the one error this
   * router cannot survive: it commits a work row for units that do not exist,
   * and `checkRoutingPlanConservesQuantities` cannot catch it because the plan
   * conserves the ORDER's quantities, not the world's.
   *
   * Keying by `item.id` makes a repeated row idempotent. The other half of an
   * unstable tiling — a row SKIPPED — degrades to under-counting that location,
   * which routes elsewhere or reports the shortfall honestly. Between the two
   * failure directions only one is safe, and this is it.
   */
  private async loadStock(input: RoutingInput): Promise<ReadonlyMap<string, number>> {
    const variantIds = [...new Set(input.lines.map((line) => line.productVariantId))];
    const byItemId = new Map<string, { key: string; quantity: number }>();

    for (const variantId of variantIds) {
      let seen = 0;

      for (let offset = 0; ; offset += INVENTORY_PAGE_SIZE) {
        const result = await this.deps.inventory.listInventoryItems(
          { productVariantId: variantId },
          { limit: INVENTORY_PAGE_SIZE, offset }
        );

        for (const view of result.items) {
          seen += 1;
          const { id, locationId, availableQuantity } = view.item;
          if (locationId === null) {
            continue;
          }
          byItemId.set(id, { key: stockKey(locationId, variantId), quantity: availableQuantity });
        }

        if (result.items.length === 0 || seen >= result.total) {
          break;
        }
      }
    }

    const stock = new Map<string, number>();
    for (const { key, quantity } of byItemId.values()) {
      stock.set(key, (stock.get(key) ?? 0) + quantity);
    }

    return stock;
  }
}

/**
 * Build the OL router. Exported from the package barrel so a host can wire it;
 * router *reachability* (when it is resolved at all) is #2407's.
 */
export function createOlFulfillmentRouter(deps: OlFulfillmentRouterDeps): FulfillmentRouterPort {
  return new OlFulfillmentRouter(deps);
}
