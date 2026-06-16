/**
 * Invoicing — ORM Entities sub-barrel.
 *
 * Host-only seam (#594). See `libs/core/src/products/orm-entities.ts` for the
 * full rationale and consumption rules. Consumed by integration-test fixtures
 * that assert real persistence against the `invoice_records` table. Plugins and
 * core port files are ESLint-blocked from importing this path.
 *
 * @module libs/core/src/invoicing/orm-entities
 */
export { InvoiceRecordOrmEntity } from './infrastructure/persistence/entities/invoice-record.orm-entity';
