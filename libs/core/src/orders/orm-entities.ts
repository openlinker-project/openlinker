/**
 * Orders — ORM Entities sub-barrel.
 *
 * Host-only seam. See `libs/core/src/products/orm-entities.ts` for the
 * full rationale and consumption rules (#594).
 *
 * Add new ORM entities here only when an external consumer needs them.
 *
 * @module libs/core/src/orders/orm-entities
 */
export { OrderRecordOrmEntity } from './infrastructure/persistence/entities/order-record.orm-entity';
// Consumer: apps/api/test/integration/orders/refund-record-crud.int-spec.ts (#2036).
export { RefundRecordOrmEntity } from './infrastructure/persistence/entities/refund-record.orm-entity';
// Consumer: apps/api/test/integration/orders/top-products-ranking.int-spec.ts (#1988) —
// direct fixture seeding of order_line_items alongside order_records.
export { OrderLineItemOrmEntity } from './infrastructure/persistence/entities/order-line-item.orm-entity';
