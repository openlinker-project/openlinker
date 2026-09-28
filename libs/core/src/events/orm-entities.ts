/**
 * Events — ORM Entities sub-barrel.
 *
 * Host-only seam. See `libs/core/src/products/orm-entities.ts` for the
 * full rationale and consumption rules (#594).
 *
 * Add new ORM entities here only when an external consumer needs them.
 *
 * @module libs/core/src/events/orm-entities
 */
export { StreamDeadLetterOrmEntity } from './infrastructure/persistence/entities/stream-dead-letter.orm-entity';
