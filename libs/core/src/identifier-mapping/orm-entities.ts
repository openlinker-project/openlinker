/**
 * Identifier Mapping — ORM Entities sub-barrel.
 *
 * Host-only seam. See `libs/core/src/products/orm-entities.ts` for the
 * full rationale and consumption rules (#594).
 *
 * Add new ORM entities here only when an external consumer needs them.
 *
 * @module libs/core/src/identifier-mapping/orm-entities
 */
export { IdentifierMappingOrmEntity } from './infrastructure/persistence/entities/identifier-mapping.orm-entity';
export { ConnectionOrmEntity } from './infrastructure/persistence/entities/connection.orm-entity';
