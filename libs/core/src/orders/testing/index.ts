/**
 * Orders - test-only exports (#3482)
 *
 * Consumed from `*.spec.ts` / `*.int-spec.ts` only, never from runtime code. Kept
 * off the production barrel so a fixture cannot be imported into a controller by
 * autocomplete - the convention the other `/testing` sub-barrels follow.
 *
 * @module libs/core/src/orders/testing
 */
export { ORDER_HEALTH_FIXTURES } from './order-health.fixtures';
export type { OrderHealthFixture, OrderHealthFixtureBucket } from './order-health.fixtures';
