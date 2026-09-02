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
import type { OrderLineItem } from '../../domain/entities/order-line-item.entity';
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
  type TaxCoverageOrderRow,
} from '../../domain/types/coverage-detection.types';

const PRE_ROLLOUT_ERA = 'pre-rollout';

/**
 * Bounded fan-out ceiling for the catalogue rate lookup (#2826) — mirrors
 * the `resolveBatchConcurrency` precedent (ADR-047/#2229): bound the number
 * of concurrent `getEffectiveTaxRate` calls rather than either running them
 * fully sequentially (the pre-#2826 behaviour) or fanning out an unbounded
 * `Promise.all` over the whole deduplicated key set.
 */
const RATE_LOOKUP_CONCURRENCY = 5;

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

    // Only a pre-rollout candidate needs a line-item read at all — every
    // other candidate is unconditionally 'tax-b' (see `classifyOne`'s doc
    // comment). Narrowing here means neither the batched line-item read nor
    // the catalogue check below does any work for the non-pre-rollout
    // majority (#2826).
    const preRolloutCandidates = candidates.filter(
      (candidate) => candidate.taxRateEra === PRE_ROLLOUT_ERA
    );

    // ONE query for every pre-rollout candidate's lines, instead of one
    // `findByOrderId` call per candidate (#2826) — the N+1 this method used
    // to make.
    const linesByOrderId = await this.orderLineItemRepository.findByOrderIds(
      preRolloutCandidates.map((candidate) => candidate.internalOrderId)
    );

    // Every unresolved line across every pre-rollout candidate, deduplicated
    // by (productId, variantId) — many lines across many orders reference
    // the same catalogue entry, so this collapses what used to be one
    // `getEffectiveTaxRate` call per UNRESOLVED LINE into one call per
    // distinct product/variant pair (#2826).
    const unresolvedLinesByOrderId = new Map<string, OrderLineItem[]>();
    const uniqueRateKeys = new Map<string, { productId: string; variantId?: string }>();
    for (const candidate of preRolloutCandidates) {
      const lines = linesByOrderId.get(candidate.internalOrderId) ?? [];
      const unresolved = lines.filter(
        (line) => resolveNetSalesTaxRate(line.taxRate).kind === 'unknown'
      );
      unresolvedLinesByOrderId.set(candidate.internalOrderId, unresolved);
      for (const line of unresolved) {
        uniqueRateKeys.set(this.rateKey(line.productId, line.variantId), {
          productId: line.productId,
          variantId: line.variantId ?? undefined,
        });
      }
    }

    // Bounded-concurrency fan-out over the DEDUPLICATED key set — never one
    // sequential `await` per line, and never an unbounded `Promise.all`
    // either (#2826).
    const rateByKey = await this.resolveRates([...uniqueRateKeys.values()]);

    const result: TaxCoverageClassification = {
      'tax-a': [],
      'tax-b': [],
      'tax-c': [],
    };

    for (const candidate of candidates) {
      const category = this.classifyOne(
        candidate,
        unresolvedLinesByOrderId.get(candidate.internalOrderId) ?? [],
        rateByKey
      );
      result[category].push(this.toRow(candidate));
    }

    return result;
  }

  /** Stable dedup key for a (productId, variantId) catalogue lookup. */
  private rateKey(productId: string, variantId: string | null | undefined): string {
    return `${productId}::${variantId ?? ''}`;
  }

  /**
   * Resolve the effective tax rate for every distinct (productId, variantId)
   * pair, with bounded concurrency (#2826) — mirrors the
   * `resolveBatchConcurrency` precedent used for the EAN-resolve batch path
   * (ADR-047/#2229): a caller that only needs the whole map back gains
   * nothing from an unbounded fan-out while spending more of the catalogue
   * read path at once. A failed lookup is recorded as `null` rather than
   * rejecting the batch — `classifyOne` treats a missing/`null` entry
   * exactly like the pre-#2826 catch block did (logged, folded into
   * 'not-checked').
   */
  private async resolveRates(
    keys: Array<{ productId: string; variantId?: string }>
  ): Promise<Map<string, StoredTaxRate | null>> {
    const rateByKey = new Map<string, StoredTaxRate | null>();
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        if (index >= keys.length) {
          return;
        }
        const { productId, variantId } = keys[index];
        try {
          const rate = await this.productsService.getEffectiveTaxRate(productId, variantId);
          rateByKey.set(this.rateKey(productId, variantId), rate);
        } catch (error) {
          // A catalogue read failure tells us nothing about the rate's
          // existence — treat like 'not-checked' rather than assuming the
          // worst (a permanent 'no-rate' claim this order does not support).
          this.logger.warn(
            `Tax coverage classification: catalogue read failed for ` +
              `[productId=${productId}, variantId=${variantId ?? 'none'}]: ${(error as Error).message}`
          );
          rateByKey.set(this.rateKey(productId, variantId), null);
        }
      }
    };

    const workerCount = Math.min(RATE_LOOKUP_CONCURRENCY, keys.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return rateByKey;
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

  private toRow(candidate: NetExcludedOrderCandidate): TaxCoverageOrderRow {
    return {
      internalOrderId: candidate.internalOrderId,
      sourceConnectionId: candidate.sourceConnectionId,
      placedAt: candidate.placedAt,
    };
  }

  /**
   * Classify one candidate, given its already-fetched unresolved lines and
   * the already-resolved catalogue rate per (productId, variantId) key
   * (#2826 — both are batched/deduplicated once per `classify()` call rather
   * than fetched here, so this method does no I/O of its own). A
   * non-pre-rollout candidate is always `'tax-b'` — the A/C split only
   * applies to the pre-rollout blanket-exclusion case (see the class doc
   * comment). A `null` map entry means the catalogue read for that key
   * failed — treated exactly like 'not-checked', matching the pre-#2826
   * per-line catch block.
   */
  private classifyOne(
    candidate: NetExcludedOrderCandidate,
    unresolvedLines: OrderLineItem[],
    rateByKey: Map<string, StoredTaxRate | null>
  ): TaxCoverageCategory {
    if (candidate.taxRateEra !== PRE_ROLLOUT_ERA) {
      return 'tax-b';
    }

    // Every line already resolves (e.g. the backfill sweep already wrote a
    // rate to each one) — the order is fully resolvable, just blocked by
    // the blanket pre-rollout exclusion.
    if (unresolvedLines.length === 0) {
      return 'tax-a';
    }

    let anyConfirmedNoRate = false;
    let anyNotChecked = false;

    for (const line of unresolvedLines) {
      const rate = rateByKey.get(this.rateKey(line.productId, line.variantId));
      if (!rate) {
        // Absent (shouldn't happen — every unresolved line's key was
        // collected before the lookup) or `null` (the catalogue read for
        // this key failed) — treat like 'not-checked'.
        anyNotChecked = true;
        continue;
      }

      const state = taxRateState(rate);
      if (state === 'known') {
        continue;
      }
      if (state === 'no-rate') {
        anyConfirmedNoRate = true;
      } else {
        anyNotChecked = true;
      }
    }

    if (!anyConfirmedNoRate && !anyNotChecked) {
      return 'tax-a';
    }
    // A confirmed no-rate line makes the order permanently unresolvable —
    // takes precedence over a merely not-yet-checked sibling line, since
    // "no remediation exists" is the stronger, more actionable fact.
    if (anyConfirmedNoRate) {
      return 'tax-b';
    }
    return 'tax-c';
  }
}
