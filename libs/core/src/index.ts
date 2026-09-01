/**
 * Core Library Exports
 *
 * Public API exports for the OpenLinker core library. Exports core bounded
 * contexts and their public interfaces.
 *
 * **Not an inventory of contexts, deliberately.** This is an AGGREGATING
 * re-export: requiring it evaluates every context listed below in one module
 * graph. A **zero-sibling-edge leaf** — `sales-documents` (#2100),
 * `fulfillment-authority` (#2304), `order-lifecycle` (#2305) and
 * `fulfillment` (#2391), whose whole
 * value is that siblings can value-import them without closing a CJS
 * module-load cycle — therefore stays OFF this barrel, the same reasoning that
 * kept `ListingsModule` off the main `@openlinker/core/listings` barrel
 * (#337/#359). Each remains reachable at its own `@openlinker/core/<ctx>`
 * subpath, which is a declared public path and the supported way to consume it.
 * `libs/core/src/__tests__/barrel-purity.spec.ts` pins the posture (#2308).
 *
 * @module libs/core/src
 */
export * from './customers';
export * from './events';
export * from './identifier-mapping';
export * from './integrations';
export * from './orders';
export * from './products';
export * from './inventory';
export * from './sync';
export * from './listings';
export * from './users';
export * from './mappings';
export * from './webhooks';
export * from './ai';
export * from './content';
