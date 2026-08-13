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
  type ICoverageGapReadService,
  type IStockAtRiskReadService,
} from '@openlinker/core/listings';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import type { INeedsAttentionService } from './needs-attention.service.interface';
import type { NeedsAttentionSummary } from './needs-attention.types';

// Per-aggregate page size — a compact "needs attention" list, not a paged
// table (#1989 consumes this as a scannable summary section).
const DEFAULT_AGGREGATE_LIMIT = 20;

@Injectable()
export class NeedsAttentionService implements INeedsAttentionService {
  constructor(
    @Inject(COVERAGE_GAP_READ_SERVICE_TOKEN)
    private readonly coverageGapReadService: ICoverageGapReadService,
    @Inject(STOCK_AT_RISK_READ_SERVICE_TOKEN)
    private readonly stockAtRiskReadService: IStockAtRiskReadService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  async getSummary(): Promise<NeedsAttentionSummary> {
    const [coverageGaps, stockAtRisk, failedSyncValue] = await Promise.all([
      this.coverageGapReadService.findCoverageGaps(DEFAULT_AGGREGATE_LIMIT),
      this.stockAtRiskReadService.findStockAtRisk(DEFAULT_AGGREGATE_LIMIT),
      this.orderRecordService.getFailedSyncValueSummary({}),
    ]);

    return {
      coverageGaps: coverageGaps.items,
      coverageGapsTotalCount: coverageGaps.totalCount,
      stockAtRisk: stockAtRisk.items,
      stockAtRiskTotalCount: stockAtRisk.totalCount,
      failedSyncValue,
    };
  }
}
