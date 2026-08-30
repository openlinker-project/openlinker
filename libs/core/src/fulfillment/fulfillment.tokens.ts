/**
 * Fulfillment — DI tokens (#2391)
 *
 * **Empty today, and present on purpose.**
 *
 * `engineering-standards.md § Symbol DI Token Re-export Convention` exempts a
 * *vocabulary-only* concern from carrying a tokens file, and says the exemption
 * "expires the day the concern needs a binding". `fulfillment` is known to need
 * one already: #2392 (`W3a-3`) lands `FULFILLMENT_WORK_REPOSITORY_TOKEN` with
 * the `fulfillment_works` schema, and ADR-053 places the A2/A3 authority
 * resolution services in this context too. The two leaves that DO hold the
 * exemption (`fulfillment-authority`, `order-lifecycle`) hold it because on
 * their ship day nobody could name their first binding; here it is nameable, so
 * applying the exemption in order to delete it one PR later would be the
 * ceremony — not this file.
 *
 * The `export {};` is load-bearing rather than filler: a `.ts` file with no
 * export statement is not a module, and `export * from './fulfillment.tokens'`
 * in the barrel would fail to compile (`TS2306`). Delete it when the first
 * Symbol lands.
 *
 * Rule 6 still applies: this file may contain **only**
 * `export const <NAME>_TOKEN = Symbol(...)` declarations. Types, helpers and
 * constants belong in `domain/types/*.types.ts` — the sub-barrel `export *`s
 * this file, so anything else here silently widens the public surface.
 *
 * @module libs/core/src/fulfillment
 * @see docs/engineering-standards.md § Symbol DI Token Re-export Convention
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */

export {};
