/**
 * Order Gift Report Reader Port (#3943)
 *
 * The one read the gift report needs over `order_records`. A port of its own
 * rather than a member of `OrderRecordRepositoryPort`: that port is mocked in full
 * across the codebase, and a report-only read has no business widening every
 * mock. The same repository class implements both.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { OrderRecord } from '../entities/order-record.entity';

export interface OrderGiftReportReaderPort {
  /**
   * One keyset page of ready, uncancelled orders in a placed-at range that carry
   * a gift (#3943): a channel line flagged as a gift, an overlay-added line, or a
   * bundle gift slot - or, with `scope: 'bundles'`, a frozen bundle expansion.
   * Ordered by `internalOrderId`; pass the last id back as `afterId`.
   *
   * The predicate runs against the stored jsonb, so it is a scan of the range:
   * the report is an operator read, not a hot path, and its range is capped.
   * It over-selects at most (an order whose added line is not a gift), and the
   * caller reads the exact lines off the domain entity.
   */
  findForGiftReport(
    filters: { from: Date; to: Date; sourceConnectionId?: string; scope: 'gifts' | 'bundles' },
    page: { afterId: string | null; limit: number }
  ): Promise<OrderRecord[]>;
}
