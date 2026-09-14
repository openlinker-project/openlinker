/**
 * Routing Rule Admin Port (#2953)
 *
 * The operator-authoring half of `oms_routing_rules`, beside the router's own
 * read-only `RoutingRuleSourcePort`. Two ports over one table because they
 * answer different questions and have different readers: the router asks "what
 * is live for this connection right now, narrowed into the closed vocabulary",
 * while an operator surface asks "what rows exist, in what order, including the
 * ones this build cannot understand".
 *
 * ## `RoutingRuleRecord` is deliberately NOT `RoutingRule`
 *
 * `coerceRoutingRule` DROPS a row whose `kind`, `name` or `afterAction` this
 * build does not recognise — correct on the read path, where routing on a
 * partial understanding would commit stock somewhere the operator did not ask
 * for. On the ADMIN path that same drop is a defect: a row that is silently not
 * routing is exactly the row an operator needs to see in order to delete it, and
 * a list that hides it reports a ruleset that is not the one on disk.
 *
 * So this record carries the three vocabulary columns as plain `string`,
 * verbatim as persisted, plus a `recognised` flag reporting what the coercer
 * decided. A surface renders the row either way and marks the unrecognised one;
 * the router still never sees it.
 *
 * ## Named `*AdminPort`, never `*RepositoryPort`
 *
 * `scripts/check-cross-context-imports.mjs` denies a `*RepositoryPort` symbol to
 * every cross-package consumer (`engineering-standards.md § Repository Ports
 * Pattern` — a repository port is an intra-context contract). This port IS
 * consumed across packages, by `apps/api`, so it must not carry that suffix.
 *
 * @module libs/oms/src/routing
 */
import type { RoutingAfterAction, RoutingRuleKind } from './routing-vocabulary.types';

/**
 * One persisted row, as an operator surface must see it.
 *
 * `kind` / `name` / `afterAction` are the STORED strings, never the narrowed
 * unions — see the header. `recognised` is `coerceRoutingRule(row) !== null`.
 */
export interface RoutingRuleRecord {
  readonly id: string;
  readonly connectionId: string;
  /** Ascending evaluation order within the ruleset. Not unique. */
  readonly position: number;
  readonly kind: string;
  readonly name: string;
  readonly afterAction: string;
  readonly priorityLocationIds: readonly string[];
  readonly effectiveFrom: Date | null;
  readonly effectiveTo: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * Whether THIS build can route on the row. `false` means the row persists,
   * is listed, and is invisible to `listActiveRules` — the remedy is to delete
   * it, since a patch of an unrecognised row is refused for the same reason the
   * coercer drops it.
   */
  readonly recognised: boolean;
}

/** Fields an operator supplies when authoring a rule. */
export interface CreateRoutingRuleInput {
  readonly connectionId: string;
  /**
   * REQUIRED. Ordering is part of the contract (#2953), so the write surface
   * expresses it explicitly rather than deriving it from insertion time.
   */
  readonly position: number;
  readonly kind: RoutingRuleKind;
  readonly name: string;
  readonly afterAction: RoutingAfterAction;
  readonly priorityLocationIds?: readonly string[];
  readonly effectiveFrom?: Date | null;
  readonly effectiveTo?: Date | null;
}

/**
 * A partial edit. `kind` is absent on purpose: it is half a rule's identity
 * under `UQ_oms_routing_rules_live_name`, so changing it is delete-and-recreate
 * rather than a patch.
 */
export interface UpdateRoutingRuleInput {
  readonly position?: number;
  readonly name?: string;
  readonly afterAction?: RoutingAfterAction;
  readonly priorityLocationIds?: readonly string[];
  readonly effectiveFrom?: Date | null;
  readonly effectiveTo?: Date | null;
}

export interface ListRoutingRulesOptions {
  /**
   * Include rows retired before `now` (`effectiveTo <= now`). Default `false`.
   *
   * Note "retired" is NOT `effectiveTo IS NOT NULL`: a row whose `effectiveTo`
   * lies in the FUTURE is still evaluated by `listActiveRules`, so excluding it
   * would hide a rule that is actively routing.
   */
  readonly includeSuperseded?: boolean;
  /** Injected so the not-retired boundary is a function of an explicit clock. */
  readonly now?: Date;
}

export interface RoutingRuleAdminPort {
  /**
   * All rules for a connection in evaluation order (`position ASC, id ASC` —
   * the same tie-break `coerceRoutingRules` applies, so the listed order IS the
   * order the router will evaluate the not-retired set in).
   */
  listRules(
    connectionId: string,
    options?: ListRoutingRulesOptions
  ): Promise<readonly RoutingRuleRecord[]>;

  /** `null` when no rule with that id belongs to that connection. */
  getRule(connectionId: string, ruleId: string): Promise<RoutingRuleRecord | null>;

  createRule(input: CreateRoutingRuleInput): Promise<RoutingRuleRecord>;

  /** Raises `RoutingRuleNotFoundError` when the rule is not this connection's. */
  updateRule(
    connectionId: string,
    ruleId: string,
    patch: UpdateRoutingRuleInput
  ): Promise<RoutingRuleRecord>;

  /** Hard delete. `false` when no such rule belongs to that connection. */
  deleteRule(connectionId: string, ruleId: string): Promise<boolean>;

  /**
   * Renumber the connection's not-retired rules to a dense `1..N` in the given
   * order, in one transaction.
   *
   * EXHAUSTIVE: `orderedRuleIds` must name every not-retired rule exactly once,
   * or the call raises `RoutingRuleReorderMismatchError` and writes nothing. A
   * partial reorder would leave the un-named rules at stale positions while the
   * operator believes they ordered the whole list.
   */
  reorderRules(
    connectionId: string,
    orderedRuleIds: readonly string[],
    now?: Date
  ): Promise<readonly RoutingRuleRecord[]>;
}
