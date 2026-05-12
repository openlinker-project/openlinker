/**
 * Sync — ORM Entities sub-barrel.
 *
 * Host-only seam. See `libs/core/src/products/orm-entities.ts` for the
 * full rationale and consumption rules (#594).
 *
 * Add new ORM entities here only when an external consumer needs them.
 * Today only `SyncJobOrmEntity` is consumed cross-context;
 * `ConnectionCursorOrmEntity` is intentionally NOT re-exported because no
 * external code reads it. Add it here if/when a test fixture needs it.
 *
 * @module libs/core/src/sync/orm-entities
 */
export { SyncJobOrmEntity } from './infrastructure/persistence/entities/sync-job.orm-entity';
