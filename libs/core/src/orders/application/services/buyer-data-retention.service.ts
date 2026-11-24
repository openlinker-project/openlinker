/**
 * Buyer Data Retention Service (#4289)
 *
 * Hides old orders from the default lists and erases the buyer's personal data
 * once an operator-set number of days have passed since the order date.
 *
 * - **Off until opted in.** The master switch defaults to off at both levels
 *   (Operational Settings and the per-connection override), so an install that
 *   sets nothing is byte-identical.
 * - **Effective rule per connection**: the connection's own
 *   `config.buyerDataRetention` fields win, the global default fills the rest.
 * - **Never deletes an order row.** Erasing replaces the buyer's identity with a
 *   placeholder code and keeps items, totals and status; `whole-order` mode
 *   additionally hides the order. Issued invoices are never touched.
 * - **Protected orders are skipped** (open hold, open return, document being
 *   issued), and the trial run counts them apart so the operator sees them.
 * - **Re-ingestion cannot undo it**: the ingestion upsert reads
 *   `personalDataErasedAt` and keeps the erased state (see the repository).
 *
 * @module libs/core/src/orders/application/services
 * @implements {IBuyerDataRetentionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CUSTOMER_PROJECTION_SERVICE_TOKEN,
  type ICustomerProjectionService,
} from '@openlinker/core/customers';
import {
  readBuyerDataRetentionConfig,
  resolveEffectiveBuyerDataRule,
} from '@openlinker/core/identifier-mapping';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
  type BuyerDataRetentionRule,
  type IOperationalSettingsService,
} from '@openlinker/core/operational-settings';
import { eraseBuyerPersonalDataFromSnapshot } from '../../domain/buyer-data-retention';
import { deriveOrderSearchText } from '../../domain/order-search-text';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import {
  densifyAgeBuckets,
  type BuyerDataAgeHistogram,
  type BuyerDataRetentionPreview,
  type BuyerDataRetentionPreviewInput,
  type BuyerDataRetentionRunResult,
  type BuyerDataRetentionScope,
} from '../../domain/types/buyer-data-retention.types';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import type { IBuyerDataRetentionService } from './buyer-data-retention.service.interface';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Orders hidden per UPDATE. */
export const BUYER_DATA_HIDE_BATCH_SIZE = 500;
/** Orders read and erased per page. */
export const BUYER_DATA_ERASE_PAGE_SIZE = 100;
/** Batches/pages per connection per run; bounds one run's database work. */
export const BUYER_DATA_MAX_BATCHES_PER_CONNECTION = 20;
/** Example rows a trial run returns. */
export const BUYER_DATA_PREVIEW_SAMPLE_COUNT = 5;

const ORDER_SOURCE_CAPABILITY = 'OrderSource';

function cutoff(now: Date, days: number): Date | null {
  return days > 0 ? new Date(now.getTime() - days * MS_PER_DAY) : null;
}

@Injectable()
export class BuyerDataRetentionService implements IBuyerDataRetentionService {
  private readonly logger = new Logger(BuyerDataRetentionService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orders: OrderRecordRepositoryPort,
    @Inject(OPERATIONAL_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IOperationalSettingsService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(CUSTOMER_PROJECTION_SERVICE_TOKEN)
    private readonly customers: ICustomerProjectionService
  ) {}

  async preview(input: BuyerDataRetentionPreviewInput): Promise<BuyerDataRetentionPreview> {
    const now = new Date();
    const scope: BuyerDataRetentionScope = {
      ...(input.connectionId !== undefined && { connectionId: input.connectionId }),
      hideBefore: cutoff(now, input.hideAfterDays),
      eraseBefore: cutoff(now, input.eraseAfterDays),
      eraseHides: input.mode === 'whole-order',
    };
    const [counts, totalOrders, samples] = await Promise.all([
      this.orders.countBuyerDataRetentionCandidates(scope),
      this.orders.countVisibleOrdersForBuyerData(input.connectionId),
      this.orders.findBuyerDataRetentionSamples(scope, BUYER_DATA_PREVIEW_SAMPLE_COUNT),
    ]);
    return { ...counts, totalOrders, samples };
  }

  async getAgeHistogram(
    connectionId?: string,
    now: Date = new Date()
  ): Promise<BuyerDataAgeHistogram> {
    const result = await this.orders.getBuyerDataAgeHistogram(now, connectionId);
    return {
      bucketUnit: 'month',
      buckets: densifyAgeBuckets(result.rows),
      totalOrders: result.totalOrders,
      oldestPlacedAt: result.oldestPlacedAt?.toISOString() ?? null,
    };
  }

  async runOnce(now: Date = new Date()): Promise<BuyerDataRetentionRunResult> {
    const view = await this.settings.resolve();
    const global: BuyerDataRetentionRule = {
      enabled: view.buyerDataRetentionEnabled.value,
      hideAfterDays: view.buyerDataHideAfterDays.value,
      eraseAfterDays: view.buyerDataEraseAfterDays.value,
      mode: view.buyerDataEraseMode.value,
    };

    const entries = await this.integrations.listCapabilityAdapters({
      capability: ORDER_SOURCE_CAPABILITY,
      lazy: true,
      includeAllStatuses: true,
    });

    let hidden = 0;
    let erased = 0;
    let customersCleared = 0;
    let budgetExhausted = false;

    for (const entry of entries) {
      const rule = resolveEffectiveBuyerDataRule(
        global,
        readBuyerDataRetentionConfig(entry.connection.config)
      );
      if (!rule.enabled) {
        continue;
      }
      try {
        const outcome = await this.applyRule(entry.connectionId, rule, now);
        hidden += outcome.hidden;
        erased += outcome.erased;
        customersCleared += outcome.customersCleared;
        budgetExhausted ||= outcome.budgetExhausted;
      } catch (error) {
        this.logger.error(
          `Buyer data retention failed for connection ${entry.connectionId}`,
          error instanceof Error ? error.stack : String(error)
        );
      }
    }

    return { hidden, erased, customersCleared, budgetExhausted };
  }

  private async applyRule(
    connectionId: string,
    rule: BuyerDataRetentionRule,
    now: Date
  ): Promise<BuyerDataRetentionRunResult> {
    let hidden = 0;
    let erased = 0;
    let customersCleared = 0;
    let budgetExhausted = false;

    const hideBefore = cutoff(now, rule.hideAfterDays);
    if (hideBefore !== null) {
      budgetExhausted = true;
      for (let batch = 0; batch < BUYER_DATA_MAX_BATCHES_PER_CONNECTION; batch += 1) {
        const count = await this.orders.hideOrdersForBuyerDataRetention(
          connectionId,
          hideBefore,
          BUYER_DATA_HIDE_BATCH_SIZE,
          now
        );
        hidden += count;
        if (count < BUYER_DATA_HIDE_BATCH_SIZE) {
          budgetExhausted = false;
          break;
        }
      }
    }

    const eraseBefore = cutoff(now, rule.eraseAfterDays);
    if (eraseBefore !== null) {
      let exhausted = true;
      for (let page = 0; page < BUYER_DATA_MAX_BATCHES_PER_CONNECTION; page += 1) {
        const rows = await this.orders.findErasableOrdersForBuyerDataRetention(
          connectionId,
          eraseBefore,
          BUYER_DATA_ERASE_PAGE_SIZE
        );
        if (rows.length === 0) {
          exhausted = false;
          break;
        }
        const result = await this.orders.erasePersonalDataForRetention(
          rows.map((row) => {
            const snapshot = eraseBuyerPersonalDataFromSnapshot(
              row.orderSnapshot,
              row.internalOrderId
            );
            return {
              internalOrderId: row.internalOrderId,
              orderSnapshot: snapshot,
              searchText: deriveOrderSearchText(snapshot, { storePii: true }),
              hide: rule.mode === 'whole-order',
            };
          }),
          now
        );
        erased += result.erased;
        const clearable = await this.orders.findCustomerIdsWithoutPersonalDataOrders(
          result.customerIds
        );
        customersCleared += await this.customers.clearPersonalData(clearable);
        // Nothing erased from a non-empty page means every row of it was
        // protected or lost to a peer; another read would return the same rows.
        if (result.erased === 0) {
          exhausted = false;
          break;
        }
        if (rows.length < BUYER_DATA_ERASE_PAGE_SIZE) {
          exhausted = false;
          break;
        }
      }
      budgetExhausted ||= exhausted;
    }

    if (hidden > 0 || erased > 0) {
      this.logger.log(
        `Buyer data retention for connection ${connectionId}: hid ${String(hidden)}, erased ${String(erased)}, cleared ${String(customersCleared)} customer projection(s)`
      );
    }
    return { hidden, erased, customersCleared, budgetExhausted };
  }
}
