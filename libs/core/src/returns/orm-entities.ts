/**
 * Returns — ORM Entities sub-barrel.
 *
 * Host-only seam. See `libs/core/src/products/orm-entities.ts` for the full
 * rationale and consumption rules (#594). Consumed by integration-test
 * fixtures; plugin packages and core port files are ESLint-blocked from it.
 *
 * @module libs/core/src/returns/orm-entities
 */
export { ReturnOrmEntity } from './infrastructure/persistence/entities/return.orm-entity';
export { ReturnLineOrmEntity } from './infrastructure/persistence/entities/return-line.orm-entity';
export { ReturnLineEventOrmEntity } from './infrastructure/persistence/entities/return-line-event.orm-entity';
