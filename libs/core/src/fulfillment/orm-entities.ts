/**
 * Fulfillment — ORM Entities sub-barrel (#2392).
 *
 * Host-only seam. See `libs/core/src/products/orm-entities.ts` for the full
 * rationale and consumption rules (#594). Consumed by integration-test
 * fixtures; plugin packages and core port files are ESLint-blocked from it.
 *
 * @module libs/core/src/fulfillment/orm-entities
 */
export { FulfillmentWorkOrmEntity } from './infrastructure/persistence/entities/fulfillment-work.orm-entity';
export { FulfillmentWorkLineOrmEntity } from './infrastructure/persistence/entities/fulfillment-work-line.orm-entity';
export { FulfillmentHoldOrmEntity } from './infrastructure/persistence/entities/fulfillment-hold.orm-entity';
