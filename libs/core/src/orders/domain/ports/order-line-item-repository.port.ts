/**
 * Order Line Item Repository Port
 *
 * Read-only contract for `order_line_items` (#1985). The write path is owned
 * by `OrderRecordRepositoryPort.upsertWithLineItems` (a single transaction
 * with the parent `order_records` row) — this port exists for standalone
 * reads by tests and future downstream aggregates (#1987/#1988), which query
 * this table directly rather than through a generic method here (mirrors how
 * `countByHealth`/`countBySla` were added straight to `OrderRecordRepository`
 * rather than through a generic query API).
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { OrderLineItem } from '../entities/order-line-item.entity';

export interface OrderLineItemRepositoryPort {
  /**
   * Find every line item for one order, ordered by `lineNumber`.
   */
  findByOrderId(orderRecordId: string): Promise<OrderLineItem[]>;
}
