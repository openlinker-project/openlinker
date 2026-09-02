/**
 * OMS DI tokens
 *
 * Symbol tokens for `@openlinker/oms`'s own bindings, in one place per
 * `engineering-standards.md` § "Symbol DI Token Re-export Convention" — the
 * `allegro.tokens.ts` shape. The barrel re-exports this file wholesale, so a
 * token added here needs no second edit.
 *
 * This file contains ONLY `Symbol` declarations: the barrel's `export *` would
 * otherwise widen the package's public surface with whatever else landed here.
 *
 * @module libs/oms/src
 */

/** {@link RoutingRuleSourcePort} — the OL router's ordered ruleset. */
export const ROUTING_RULE_SOURCE_TOKEN = Symbol('RoutingRuleSourcePort');
