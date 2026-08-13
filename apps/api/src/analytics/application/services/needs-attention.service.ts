/**
 * Needs Attention Service
 *
 * Composes the three "needs attention" aggregates (#1983) — coverage gaps,
 * stock at risk, and value stuck in failed syncs — into one response. Lives
 * at the apps/api layer (not in a core context) because it is the one place
 * three sibling CORE contexts (listings, orders) are combined for a single
 * HTTP response; composing here avoids adding a new core-to-core dependency
 * edge that none of those contexts otherwise needs.
 *
 * The failed-sync-value read goes through `IOrderRecordService` — never
 * `OrderRecordRepositoryPort` directly, which `scripts/check-cross-context-imports.mjs`
 * rejects for any `apps/**` importer not already on its allow-list (see
 * architecture-overview.md § "Cross-context dependencies in core").
 *
 * @module apps/api/src/analytics/application/services
 * @implements {INeedsAttentionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  COVERAGE_GAP_READ_SERVICE_TOKEN,
  STOCK_AT_RISK_READ_SERVICE_TOKEN,
  type CoverageGapsResult,
  type ICoverageGapReadService,
  type IStockAtRiskReadService,
  type StockAtRiskResult,
} from '@openlinker/core/listings';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import type { INeedsAttentionService } from './needs-attention.service.interface';
import type { NeedsAttentionSummary } from './needs-attention.types';

// Per-aggregate page size — a compact "needs attention" list, not a paged
// table (#1989 consumes this as a scannable summary section).
const DEFAULT_AGGREGATE_LIMIT = 20;

const EMPTY_COVERAGE_GAPS: CoverageGapsResult = { items: [], totalCount: 0 };
const EMPTY_STOCK_AT_RISK: StockAtRiskResult = { items: [], totalCount: 0 };

@Injectable()
export class NeedsAttentionService implements INeedsAttentionService {
  private readonly logger = new Logger(NeedsAttentionService.name);

  constructor(
    @Inject(COVERAGE_GAP_READ_SERVICE_TOKEN)
    private readonly coverageGapReadService: ICoverageGapReadService,
    @Inject(STOCK_AT_RISK_READ_SERVICE_TOKEN)
    private readonly stockAtRiskReadService: IStockAtRiskReadService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  async getSummary(): Promise<NeedsAttentionSummary> {
    // `allSettled`, not `all` — one aggregate failing (e.g. a transient DB
    // hiccup on one query) must not 500 the whole panel when the other two
    // sections are healthy. A failed section falls back to an empty result
    // and is logged, rather than surfaced to the caller as a partial-content
    // signal — the FE has no per-section degraded state to render today.
    const [coverageGaps, stockAtRisk, failedSyncValue] = await Promise.all([
      this.settleSection('coverageGaps', EMPTY_COVERAGE_GAPS, () =>
        this.coverageGapReadService.findCoverageGaps(DEFAULT_AGGREGATE_LIMIT)
      ),
      this.settleSection('stockAtRisk', EMPTY_STOCK_AT_RISK, () =>
        this.stockAtRiskReadService.findStockAtRisk(DEFAULT_AGGREGATE_LIMIT)
      ),
      this.settleSection('failedSyncValue', null, () =>
        this.orderRecordService.getFailedSyncValueSummary({})
      ),
    ]);

    return {
      coverageGaps: coverageGaps.items,
      coverageGapsTotalCount: coverageGaps.totalCount,
      stockAtRisk: stockAtRisk.items,
      stockAtRiskTotalCount: stockAtRisk.totalCount,
      failedSyncValue: failedSyncValue ?? {
        count: 0,
        totalValue: 0,
        mixedCurrency: false,
        oldestFailedAt: null,
      },
    };
  }

  private async settleSection<T>(
    section: string,
    fallback: T,
    read: () => Promise<T>
  ): Promise<T> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(
        `Needs-attention "${section}" aggregate failed; falling back to an empty section: ${(error as Error).message}`
      );
      return fallback;
    }
  }
}
