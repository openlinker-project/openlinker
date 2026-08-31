/**
 * Fulfillment — DI tokens (#2391, first binding #2392)
 *
 * #2391 created this file holding only `export {};`, and reserved the first
 * Symbol below by name: *"#2392 (`W3a-3`) lands `FULFILLMENT_WORK_REPOSITORY_TOKEN`
 * with the `fulfillment_works` schema"*. That binding is now here, which ends
 * the `engineering-standards.md § Symbol DI Token Re-export Convention`
 * vocabulary-only exemption for this context — exactly as #2391 predicted, and
 * for the reason it declined to take the exemption in the first place: the
 * first binding was already nameable, so claiming an exemption in order to
 * delete it one PR later would have been the ceremony.
 *
 * The `export {};` placeholder is gone; a real `export const` keeps the file a
 * module, so the barrel's `export * from './fulfillment.tokens'` still compiles
 * (the `TS2306` that placeholder existed to prevent).
 *
 * Rule 6 still applies, and applies harder now that the file is non-empty: this
 * file may contain **only** `export const <NAME>_TOKEN = Symbol(...)`
 * declarations. Types, helpers and constants belong in
 * `domain/types/*.types.ts` — the sub-barrel `export *`s this file, so anything
 * else here silently widens the public surface.
 *
 * @module libs/core/src/fulfillment
 * @see docs/engineering-standards.md § Symbol DI Token Re-export Convention
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */

export const FULFILLMENT_WORK_REPOSITORY_TOKEN = Symbol('FulfillmentWorkRepositoryPort');

/** Executor handshake (#2399). `FulfillmentHandshakeService` binds here. */
export const FULFILLMENT_HANDSHAKE_SERVICE_TOKEN = Symbol('IFulfillmentHandshakeService');

/** Progress ingress (#2400). `FulfillmentProgressService` binds here. */
export const FULFILLMENT_PROGRESS_SERVICE_TOKEN = Symbol('IFulfillmentProgressService');

/** At-most-once progress claim (#2400). Intra-context; not on the barrel's port surface. */
export const FULFILLMENT_PROGRESS_CLAIM_REPOSITORY_TOKEN = Symbol(
  'FulfillmentProgressClaimRepositoryPort'
);

/**
 * Cross-context work lookup (#2402). `FulfillmentWorkQueryService` binds here.
 *
 * Named `..._WORK_QUERY_...` and checked against `shipping.tokens.ts`, which
 * already owns a `FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN` for the older
 * shipping-local sense of "fulfillment": both barrels `export *` over their
 * token files, so a same-named Symbol in each would be ambiguous for any
 * consumer importing both.
 */
export const FULFILLMENT_WORK_QUERY_SERVICE_TOKEN = Symbol('IFulfillmentWorkQueryService');

/** Routing intent row (#2394). Intra-context; the PORT is not on the barrel. */
export const ROUTING_DECISION_REPOSITORY_TOKEN = Symbol('RoutingDecisionRepositoryPort');

/** Dispatch-relay at-most-once gate (#2401). `FulfillmentRelayGateService` binds here. */
export const FULFILLMENT_RELAY_GATE_SERVICE_TOKEN = Symbol('IFulfillmentRelayGateService');
