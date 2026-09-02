/**
 * Tax Coverage Detection Service
 *
 * Splits the `netExcludedCount` population (already computed by
 * `OrderRecordRepositoryPort.getDailyOrderAggregates`) into the three
 * operator-actionable sub-categories the Data Coverage panel's mockup
 * distinguishes (#2465):
 *
 * - `'tax-a'` (unconfirmed-but-resolvable): `taxRateEra = 'pre-rollout'`
 *   AND every one of the order's unresolved lines resolves a rate from the
 *   CURRENT catalogue — either because `TaxRateBackfillService` already
 *   wrote it (`order_line_items.taxRate` is now set), or because a
 *   read-only re-check via `IProductsService.getEffectiveTaxRate` resolves
 *   it right now. Would become net-eligible if a future
 *   `includeGuessedVatRatesInNetSales` setting (Phase 5) were turned on —
 *   this service never writes anything, it only reports the fact.
 * - `'tax-b'` (no tax rate at all): either the order is excluded for a
 *   reason OTHER than the pre-rollout era (a genuinely unresolved line on a
 *   post-rollout order, or no line items — {@link
 *   findNetExcludedOrderCandidates}'s population can include both), or it
 *   IS pre-rollout but the catalogue has confirmed at least one unresolved
 *   line's product/variant carries NO rate (`taxRateState === 'no-rate'`).
 *   No remediation action exists for this category.
 * - `'tax-c'` (pre-rollout, not yet resolvable): `taxRateEra =
 *   'pre-rollout'`, none of the order's unresolved lines were confirmed
 *   rate-less, but at least one has never been asked about a rate at all
 *   (`taxRateState === 'not-checked'`). A later catalogue sync, or the
 *   backfill sweep once it reaches this connection's frontier, may still
 *   resolve it.
 *
 * Read-only by design: this service calls `IProductsService.
 * getEffectiveTaxRate` to CHECK resolvability, but never calls
 * `TaxRateBackfillService.backfillPage` or writes to `order_line_items` —
 * classification must not have the side effect of resolving what it is
 * merely reporting on.
 *
 * Not pushed into SQL: whether a line "resolves a rate" depends on a live
 * catalogue read (`IProductsService.getEffectiveTaxRate`), which has no SQL
 * equivalent — so the base candidate population is fetched UNPAGED (see
 * `OrderRecordRepositoryPort.findNetExcludedOrderCandidates`'s doc comment)
 * and classified here in the application layer; page slicing for
 * {@link getCategoryPage} happens in-memory over the already-classified
 * result.
 *
 * @module libs/core/src/orders/application/services
 * @implements {ITaxCoverageDetectionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  taxRateState,
  type StoredTaxRate,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import type { ITaxCoverageDetectionService } from './tax-coverage-detection.service.interface';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import { ORDER_RECORD_REPOSITORY_TOKEN, ORDER_LINE_ITEM_REPOSITORY_TOKEN } from '../../orders.tokens';
import { resolveNetSalesTaxRate } from '../../domain/types/net-sales-tax-rate.types';
import type { SalesAnalyticsFilters } from '../../domain/types/order-sales-analytics.types';
import {
  TaxCoverageCategoryValues,
  type CoverageDetectionPagination,
  type NetExcludedOrderCandidate,
  type PaginatedTaxCoverageOrders,
  type TaxCoverageCategory,
  type TaxCoverageClassification,
  type TaxCoverageLineRateObservation,
  type TaxCoverageOrderRow,
} from '../../domain/types/coverage-detection.types';
import type { OrderLineItem } from '../../domain/entities/order-line-item.entity';

const PRE_ROLLOUT_ERA = 'pre-rollout';

@Injectable()
export class TaxCoverageDetectionService implements ITaxCoverageDetectionService {
  private readonly logger = new Logger(TaxCoverageDetectionService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort,
    @Inject(ORDER_LINE_ITEM_REPOSITORY_TOKEN)
    private readonly orderLineItemRepository: OrderLineItemRepositoryPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService
  ) {}

  async classify(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<TaxCoverageClassification> {
    const candidates = await this.orderRecordRepository.findNetExcludedOrderCandidates(
      filters,
      currentReportingCurrency,
      includeBackfilledPreRollout
    );

    const result: TaxCoverageClassification = {
      'tax-a': [],
      'tax-b': [],
      'tax-c': [],
    };

    for (const candidate of candidates) {
      const { category, lineRates } = await this.classifyOne(candidate);
      result[category].push(this.toRow(candidate, lineRates));
    }

    return result;
  }

  async getCategoryPage(
    category: TaxCoverageCategory,
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    pagination: CoverageDetectionPagination,
    includeBackfilledPreRollout = false
  ): Promise<PaginatedTaxCoverageOrders> {
    const classification = await this.classify(
      filters,
      currentReportingCurrency,
      includeBackfilledPreRollout
    );
    const rows = classification[category];
    return {
      items: rows.slice(pagination.offset, pagination.offset + pagination.limit),
      total: rows.length,
    };
  }

  async getCategoryCounts(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<Record<TaxCoverageCategory, number>> {
    const classification = await this.classify(
      filters,
      currentReportingCurrency,
      includeBackfilledPreRollout
    );
    const counts: Partial<Record<TaxCoverageCategory, number>> = {};
    for (const category of TaxCoverageCategoryValues) {
      counts[category] = classification[category].length;
    }
    return counts as Record<TaxCoverageCategory, number>;
  }

  async getAllCategoryPages(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    pagination: CoverageDetectionPagination,
    includeBackfilledPreRollout = false
  ): Promise<Record<TaxCoverageCategory, PaginatedTaxCoverageOrders>> {
    const classification = await this.classify(
      filters,
      currentReportingCurrency,
      includeBackfilledPreRollout
    );
    const pages: Partial<Record<TaxCoverageCategory, PaginatedTaxCoverageOrders>> = {};
    for (const category of TaxCoverageCategoryValues) {
      const rows = classification[category];
      pages[category] = {
        items: rows.slice(pagination.offset, pagination.offset + pagination.limit),
        total: rows.length,
      };
    }
    return pages as Record<TaxCoverageCategory, PaginatedTaxCoverageOrders>;
  }

  private toRow(
    candidate: NetExcludedOrderCandidate,
    lineRates: TaxCoverageLineRateObservation[]
  ): TaxCoverageOrderRow {
    return {
      internalOrderId: candidate.internalOrderId,
      sourceConnectionId: candidate.sourceConnectionId,
      placedAt: candidate.placedAt,
      lineRates,
    };
  }

  /**
   * Resolve one observation per line (#2798) — never discarded after
   * computing the bucket, since a mixed-rate order needs its own per-line
   * rates rather than one order-level value. A line whose own
   * `order_line_items.taxRate` already resolves (the backfill sweep
   * already wrote it, or it was never excluded in the first place) reports
   * that value directly with no catalogue call; only a line
   * `resolveNetSalesTaxRate` reads as `'unknown'` triggers the live
   * `IProductsService.getEffectiveTaxRate` read `classifyOne` already made
   * for that same line — this mirrors that call exactly rather than adding
   * a second one.
   */
  private async resolveLineRates(
    lines: OrderLineItem[],
    orderId: string
  ): Promise<TaxCoverageLineRateObservation[]> {
    const observations: TaxCoverageLineRateObservation[] = [];

    for (const line of lines) {
      if (resolveNetSalesTaxRate(line.taxRate).kind === 'known') {
        observations.push({
          productId: line.productId,
          variantId: line.variantId,
          rateCode: line.taxRate,
          state: 'known',
        });
        continue;
      }

      let rate: StoredTaxRate;
      try {
        rate = await this.productsService.getEffectiveTaxRate(
          line.productId,
          line.variantId ?? undefined
        );
      } catch (error) {
        // A catalogue read failure tells us nothing about the rate's
        // existence — treat like 'not-checked' rather than assuming the
        // worst (a permanent 'no-rate' claim this order does not support).
        this.logger.warn(
          `Tax coverage classification: catalogue read failed for order ${orderId} ` +
            `line [productId=${line.productId}, variantId=${line.variantId ?? 'none'}]: ${(error as Error).message}`
        );
        observations.push({
          productId: line.productId,
          variantId: line.variantId,
          rateCode: null,
          state: 'not-checked',
        });
        continue;
      }

      const state = taxRateState(rate);
      observations.push({
        productId: line.productId,
        variantId: line.variantId,
        rateCode: state === 'known' ? rate.code : null,
        state,
      });
    }

    return observations;
  }

  /**
   * Classify one candidate. A non-pre-rollout candidate is always `'tax-b'`
   * — the A/C split only applies to the pre-rollout blanket-exclusion case
   * (see the class doc comment) — and, exactly as before #2798, without
   * touching line items or the catalogue at all: nothing about the
   * candidate's own lines decided this bucket, so `lineRates` is `[]`
   * rather than paying for a read whose result classification never
   * consults. The pre-rollout branches below resolve and return the
   * per-line rate observations, so a row IN THOSE buckets is never missing
   * the data behind its own classification.
   */
  private async classifyOne(
    candidate: NetExcludedOrderCandidate
  ): Promise<{ category: TaxCoverageCategory; lineRates: TaxCoverageLineRateObservation[] }> {
    if (candidate.taxRateEra !== PRE_ROLLOUT_ERA) {
      return { category: 'tax-b', lineRates: [] };
    }

    const lines = await this.orderLineItemRepository.findByOrderId(candidate.internalOrderId);
    const lineRates = await this.resolveLineRates(lines, candidate.internalOrderId);

    let anyConfirmedNoRate = false;
    let anyNotChecked = false;

    for (const observation of lineRates) {
      if (observation.state === 'no-rate') {
        anyConfirmedNoRate = true;
      } else if (observation.state === 'not-checked') {
        anyNotChecked = true;
      }
    }

    if (!anyConfirmedNoRate && !anyNotChecked) {
      return { category: 'tax-a', lineRates };
    }
    // A confirmed no-rate line makes the order permanently unresolvable —
    // takes precedence over a merely not-yet-checked sibling line, since
    // "no remediation exists" is the stronger, more actionable fact.
    if (anyConfirmedNoRate) {
      return { category: 'tax-b', lineRates };
    }
    return { category: 'tax-c', lineRates };
  }
}
