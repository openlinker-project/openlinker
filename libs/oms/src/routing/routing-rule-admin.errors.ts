/**
 * Routing Rule Admin — domain errors (#2953)
 *
 * The repository converts infrastructure failures into these before they leave
 * the package (`engineering-standards.md § Repository Error Handling`), so
 * `apps/api` maps a domain condition to a status rather than sniffing a driver
 * error string.
 *
 * ## These names must stay distinct from `@openlinker/core/mappings`
 *
 * That context already exports `DuplicateRoutingRuleException` for the ADR-012
 * dispatch-routing surface, which is a different table and a different question.
 * Two same-named classes fail `instanceof` against each other SILENTLY, and the
 * HTTP mapper would then answer 500 for a refusal a service raised deliberately
 * — the #2332/#2333 shape recorded in `docs/architecture-overview.md § Returns`.
 * Hence `…Error` here against their `…Exception`, and `DuplicateLive…` against
 * their `Duplicate…`.
 *
 * @module libs/oms/src/routing
 */

/** No rule with that id belongs to that connection. */
export class RoutingRuleNotFoundError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly ruleId: string
  ) {
    super(`Routing rule ${ruleId} not found on connection ${connectionId}`);
    this.name = 'RoutingRuleNotFoundError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * A live rule already claims this `(kind, name)` on this connection —
 * `UQ_oms_routing_rules_live_name`. Retire the incumbent (set `effectiveTo`) or
 * edit it, rather than adding a second.
 */
export class DuplicateLiveRoutingRuleError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly kind: string,
    public readonly ruleName: string
  ) {
    super(
      `Connection ${connectionId} already has a live '${kind}' rule named '${ruleName}'. ` +
        `Retire or edit the existing rule instead of adding a second.`
    );
    this.name = 'DuplicateLiveRoutingRuleError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * A reorder did not name exactly the connection's not-retired rules.
 *
 * Both sides are reported because they are different operator mistakes: a
 * `missing` id is a rule that would have kept a stale position, and an `unknown`
 * id names a rule that is retired, deleted, or another connection's.
 */
export class RoutingRuleReorderMismatchError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly missingRuleIds: readonly string[],
    public readonly unknownRuleIds: readonly string[]
  ) {
    super(
      `Reorder must name every active routing rule on connection ${connectionId} exactly once. ` +
        `Missing: [${missingRuleIds.join(', ') || 'none'}]. ` +
        `Not active on this connection: [${unknownRuleIds.join(', ') || 'none'}].`
    );
    this.name = 'RoutingRuleReorderMismatchError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}
