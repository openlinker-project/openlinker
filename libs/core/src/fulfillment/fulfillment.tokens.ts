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

export const FULFILLMENT_HANDSHAKE_SERVICE_TOKEN = Symbol('IFulfillmentHandshakeService');
