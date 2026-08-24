/**
 * Tax Rate Backfill Service
 *
 * Implements the tax-rate backfill sweep (#2440). For each rate-less
 * `order_line_items` row on one connection's frontier, resolves the line's
 * product/variant against the CURRENT catalogue via
 * `IProductsService.getEffectiveTaxRate` — the same variant-overrides-product
 * precedence ingestion itself uses — and, on a resolved answer, writes it to
 * both the analytics read-model row and (additively) the order's own
 * `orderSnapshot`, tagged `taxSource: 'backfill'` so it is never mistaken for
 * a rate the shop or channel confirmed at order time.
 *
 * A line whose catalogue rate is still unresolved (never synced, or the shop
 * genuinely carries none) is left untouched — there is nothing to invent,
 * and it stays in the excluded population for a later run to pick up once
 * the catalogue itself answers.
 *
 * @module libs/core/src/orders/application/services
 * @implements {ITaxRateBackfillService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  taxRateState,
  type StoredTaxRate,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import type {
  ITaxRateBackfillService,
  TaxRateBackfillPageInput,
  TaxRateBackfillPageResult,
} from './tax-rate-backfill.service.interface';
import { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { ORDER_LINE_ITEM_REPOSITORY_TOKEN, ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class TaxRateBackfillService implements ITaxRateBackfillService {
  private readonly logger = new Logger(TaxRateBackfillService.name);

  constructor(
    @Inject(ORDER_LINE_ITEM_REPOSITORY_TOKEN)
    private readonly orderLineItemRepository: OrderLineItemRepositoryPort,
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService
  ) {}

  async backfillPage(input: TaxRateBackfillPageInput): Promise<TaxRateBackfillPageResult> {
    const lines = await this.orderLineItemRepository.findPageWithNoTaxRate({
      sourceConnectionId: input.sourceConnectionId,
      limit: input.limit,
      afterId: input.afterId,
    });

    let updated = 0;
    for (const line of lines) {
      const wasUpdated = await this.backfillOneLine(line);
      if (wasUpdated) updated += 1;
    }

    const nextCursor =
      lines.length === input.limit ? lines[lines.length - 1].id : null;

    return { scanned: lines.length, updated, nextCursor };
  }

  /**
   * Resolve and write one line's rate. Best-effort per line: a catalogue
   * read failure or an unresolved rate is logged and skipped, never thrown —
   * one bad line must not abort the whole page.
   */
  private async backfillOneLine(line: {
    id: string;
    orderRecordId: string;
    lineNumber: number;
    productId: string;
    variantId: string | null;
  }): Promise<boolean> {
    let rate: StoredTaxRate;
    try {
      rate = await this.productsService.getEffectiveTaxRate(
        line.productId,
        line.variantId ?? undefined
      );
    } catch (error) {
      this.logger.warn(
        `Tax-rate backfill: catalogue read failed for line ${line.id} ` +
          `[productId=${line.productId}, variantId=${line.variantId ?? 'none'}]: ${(error as Error).message}`
      );
      return false;
    }

    if (taxRateState(rate) !== 'known' || !rate.code) {
      return false;
    }

    const taxRateReadAt = new Date();
    await this.orderLineItemRepository.backfillTaxRate(line.id, {
      taxRate: rate.code,
      taxSource: 'backfill',
      taxRateReadAt,
    });
    await this.orderRecordRepository.patchSnapshotTaxRates(line.orderRecordId, line.lineNumber, {
      taxRate: rate.code,
      taxSource: 'backfill',
      taxRateReadAt,
    });
    return true;
  }
}
