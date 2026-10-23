/**
 * Order Search Text Reindex Service (#3507 G03-14)
 *
 * Re-derives `order_records.searchText` for rows whose stored text no longer
 * matches `deriveOrderSearchText` under the CURRENT `OL_STORE_PII` setting.
 *
 * Why it exists: every write derives the text afresh (`OrderRecordRepository.
 * toOrm`), but a row is only rewritten when its order is re-ingested. An order
 * stored while PII storage was on keeps its buyer's name and email in the
 * search corpus after the flag is turned off, so the install stays searchable
 * by surname until each such order happens to be touched again — which for a
 * delivered order is never. This pass closes that window.
 *
 * Only runs when `OL_STORE_PII` is off. With it on, every write already
 * indexes what the install stores, and a stale row can only be missing data
 * (a row written while PII was off has redacted snapshot fields to begin
 * with), never leaking it — so there is nothing for this pass to repair, and
 * a full-table read on every tick would be pure cost.
 *
 * Budgeted (`PAGE_SIZE` x `MAX_PAGES_PER_RUN` rows per pass) and keyset-paged
 * on the text primary key; the caller carries `nextCursor` between passes.
 * Each rewrite is conditional on the text it read (see
 * `OrderSearchTextRewrite`), so a concurrent ingestion always wins.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderSearchTextReindexService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { getEnvBoolean } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { deriveOrderSearchText } from '../../domain/order-search-text';
import type {
  OrderSearchTextReindexRunResult,
  OrderSearchTextRewrite,
} from '../../domain/types/order-search-text-reindex.types';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import type { IOrderSearchTextReindexService } from './order-search-text-reindex.service.interface';

/** Rows read (and at most rewritten) per page — one unit of the pass budget. */
export const ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE = 500;

/**
 * Pages per pass. Bounds one pass to `PAGE_SIZE * MAX_PAGES_PER_RUN` rows
 * however large the table is; a larger table drains across passes via the
 * returned cursor (the `OrderExportRetentionService` budget shape).
 */
export const ORDER_SEARCH_TEXT_REINDEX_MAX_PAGES_PER_RUN = 40;

@Injectable()
export class OrderSearchTextReindexService implements IOrderSearchTextReindexService {
  private readonly logger = new Logger(OrderSearchTextReindexService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort
  ) {}

  async runOnce(afterInternalOrderId: string | null): Promise<OrderSearchTextReindexRunResult> {
    // The same flag and default `getPiiConfig().storePii` resolves, without
    // its unrelated throw on an unset `OL_PII_HASH_SALT` — and the same read
    // `OrderRecordRepository.toOrm` makes, so the pass and every write agree.
    const storePii = getEnvBoolean('OL_STORE_PII', true);
    if (storePii) {
      return { status: 'skipped-pii-stored' };
    }

    let cursor = afterInternalOrderId;
    let scanned = 0;
    let rewritten = 0;

    for (let page = 0; page < ORDER_SEARCH_TEXT_REINDEX_MAX_PAGES_PER_RUN; page += 1) {
      const rows = await this.repository.findSearchTextReindexPage(
        cursor,
        ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE
      );
      if (rows.length === 0) {
        return this.completed(scanned, rewritten, false, null);
      }

      const rewrites: OrderSearchTextRewrite[] = [];
      for (const row of rows) {
        const searchText = deriveOrderSearchText(row.orderSnapshot, { storePii });
        if (searchText !== row.searchText) {
          rewrites.push({
            internalOrderId: row.internalOrderId,
            expectedSearchText: row.searchText,
            searchText,
          });
        }
      }

      scanned += rows.length;
      if (rewrites.length > 0) {
        rewritten += await this.repository.rewriteSearchText(rewrites);
      }
      cursor = rows[rows.length - 1].internalOrderId;

      // A short page is the end of the table; a full one MIGHT be followed by
      // more, so the loop continues rather than stopping on the count alone.
      if (rows.length < ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE) {
        return this.completed(scanned, rewritten, false, null);
      }
    }

    return this.completed(scanned, rewritten, true, cursor);
  }

  private completed(
    scanned: number,
    rewritten: number,
    budgetExhausted: boolean,
    nextCursor: string | null
  ): OrderSearchTextReindexRunResult {
    if (rewritten > 0) {
      this.logger.log(
        `Order search text reindex: rewrote ${String(rewritten)} of ${String(scanned)} scanned row(s) ` +
          'to drop personal data under OL_STORE_PII=false'
      );
    }
    return { status: 'completed', scanned, rewritten, budgetExhausted, nextCursor };
  }
}
