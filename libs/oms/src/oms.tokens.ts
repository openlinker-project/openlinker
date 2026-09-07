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

/**
 * {@link RoutingRuleAdminPort} — operator authoring of that same ruleset (#2953).
 *
 * A SECOND token over one repository, deliberately: the router's read and the
 * operator's CRUD are different contracts with different narrowing rules (the
 * read drops a row this build cannot understand; the admin surface must show
 * it), so a consumer binds to the one it means.
 */
export const ROUTING_RULE_ADMIN_TOKEN = Symbol('RoutingRuleAdminPort');
