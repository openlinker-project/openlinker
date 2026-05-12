/**
 * Products — ORM Entities sub-barrel.
 *
 * Host-only seam. Consumed exclusively by:
 *   - TypeORM data-source / migration loaders (apps/api/src/database/data-source.ts).
 *   - Integration-test fixtures and helpers (apps/{api,worker}/test/integration/**).
 *   - Core orchestration modules registering sibling-context entities.
 *
 * Plugin packages (libs/integrations/**) and port files must NOT import from
 * here — ESLint enforces this in .eslintrc.js. ORM entities are TypeORM-
 * decorated infrastructure detail; exposing them couples plugins to TypeORM.
 * See #594 (Modularity Thread F · F7).
 *
 * Add new ORM entities here only when an external consumer needs them.
 * Same-module registrations should use relative paths into
 * `infrastructure/persistence/entities/`.
 *
 * @module libs/core/src/products/orm-entities
 */
export { ProductOrmEntity } from './infrastructure/persistence/entities/product.orm-entity';
export { ProductVariantOrmEntity } from './infrastructure/persistence/entities/product-variant.orm-entity';
