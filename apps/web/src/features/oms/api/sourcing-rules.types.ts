/**
 * Sourcing-rule transport types (#3056, `W3a` sourcing-rules admin UI)
 *
 * The frontend view of the #2953 admin surface
 * (`GET/POST /connections/:connectionId/sourcing-rules`, `PUT .../order`,
 * `GET/PATCH/DELETE .../sourcing-rules/:ruleId`) — the ordered filter/sort
 * ruleset the OL fulfilment router evaluates.
 *
 * ## Not to be confused with `features/mappings`' routing rules
 *
 * `apps/api/src/mappings/http/fulfillment-routing.controller.ts` mounts
 * `connections/:connectionId/routing-rules`, the ADR-012 **dispatch** surface —
 * *"which processor or carrier ships this?"*. These answer *"which location
 * sources it?"*. The backend keeps the two URL namespaces apart deliberately
 * (`oms-sourcing-rules.controller.ts` explains why); this module keeps the
 * frontend names apart for the same reason.
 *
 * ## `kind`, `name` and `afterAction` are `string`, not mirrored unions
 *
 * The backend stores all three VERBATIM and reports `recognised: false` for a
 * row this version of OpenLinker cannot evaluate — precisely so such a row is
 * listed, found and deleted rather than hidden. A mirrored union here would
 * invert that: the day the API gains a rule name, the unrecognised row fails to
 * parse and the whole table reports "no rules" for a connection that has some,
 * which is a false statement about the operator's own configuration.
 *
 * The dialog (#3058) still needs a list of names to OFFER. That is a separate
 * concern from what may arrive on the wire, it comes from
 * `libs/oms/src/routing/routing-vocabulary.types.ts`, `apps/web` cannot import
 * `@openlinker/*` (#591), and a mirror therefore needs its own
 * `scripts/check-*-mirror.mjs` guard. #3058 owns that; nothing here may be
 * mistaken for it.
 *
 * ## Timestamps are ISO STRINGS
 *
 * `SourcingRuleResponseDto` already declares them as `string`
 * (`rule.createdAt.toISOString()`), and every schema in this app types them
 * `z.string()` — a `Date`-typed field holding a string type-checks and then
 * throws on `.toLocaleString()`.
 *
 * @module apps/web/src/features/oms/api
 */

/** One sourcing rule as the admin API reports it. Mirrors `SourcingRuleResponseDto`. */
export interface SourcingRule {
  id: string;
  connectionId: string;
  /** Ascending evaluation order. Ties break on `id` — server-side, not here. */
  position: number;
  /** Stored verbatim by the API — see `recognised`. */
  kind: string;
  /** Stored verbatim by the API — see `recognised`. */
  name: string;
  /** Stored verbatim by the API — see `recognised`. */
  afterAction: string;
  priorityLocationIds: string[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Whether this build of OpenLinker can evaluate the rule. `false` means the
   * row is persisted but INVISIBLE to the router: it is listed so it can be
   * found and deleted, and it cannot be edited, because a successful edit would
   * imply it routes.
   */
  recognised: boolean;
}

/** The one list filter the endpoint accepts. */
export interface SourcingRuleFilters {
  /**
   * Include rules RETIRED before now (`effectiveTo` in the past). A rule
   * retiring in the FUTURE is still evaluated by the router and is always
   * listed, whatever this is set to.
   */
  includeSuperseded?: boolean;
}

/**
 * Create body. `position` is REQUIRED by the contract: order is stated, never
 * derived from insertion time.
 */
export interface CreateSourcingRuleRequest {
  position: number;
  kind: string;
  name: string;
  afterAction: string;
  priorityLocationIds?: string[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/**
 * Patch body.
 *
 * `kind` is absent on purpose — it is half the rule's identity, so the API does
 * not accept it and changing it is delete-and-recreate. `effectiveFrom` /
 * `effectiveTo` are `string | null`: `null` CLEARS the bound, which is a
 * different instruction from omitting the key, so both states have to be
 * expressible.
 */
export interface UpdateSourcingRuleRequest {
  position?: number;
  name?: string;
  afterAction?: string;
  priorityLocationIds?: string[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/**
 * Reorder body. EXHAUSTIVE: it must name every non-retired rule exactly once,
 * or the API refuses with 409 and writes nothing. Never send a delta.
 */
export interface ReorderSourcingRulesRequest {
  ruleIds: string[];
}
