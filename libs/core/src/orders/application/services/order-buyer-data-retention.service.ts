/**
 * Order Buyer Data Retention Service (#4178)
 *
 * See `IOrderBuyerDataRetentionService`. One pass reads, per source connection
 * that declares `buyerDataRetentionDays`, the orders past their retention
 * anchor (frontier-as-query: a redacted row leaves the set) and redacts them
 * one by one, at most `MAX_ORDERS_PER_CONNECTION` per run, so a backlog drains
 * over several runs instead of one long transaction.
 *
 * Connections are found through `listCapabilityAdapters('OrderSource', lazy,
 * all statuses)`: no adapter is built, and a disabled connection's old orders
 * are still cleaned - the limit binds whether or not the connection is in use.
 *
 * @module application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { getEnvBoolean } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';

import { redactOrderSnapshotBuyerData } from '../../domain/order-buyer-data-redaction';
import { deriveOrderSearchText } from '../../domain/order-search-text';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import type {
  OrderBuyerDataRetentionConnectionResult,
  OrderBuyerDataRetentionRunResult,
} from '../../domain/types/order-buyer-data-retention.types';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import type { IOrderBuyerDataRetentionService } from './order-buyer-data-retention.service.interface';

export const BUYER_DATA_RETENTION_PAGE_SIZE = 200;
export const BUYER_DATA_RETENTION_MAX_ORDERS_PER_CONNECTION = 2000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class OrderBuyerDataRetentionService implements IOrderBuyerDataRetentionService {
  private readonly logger = new Logger(OrderBuyerDataRetentionService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async runOnce(now: Date = new Date()): Promise<OrderBuyerDataRetentionRunResult> {
    const sources = await this.integrations.listCapabilityAdapters<unknown>({
      capability: 'OrderSource',
      lazy: true,
      includeAllStatuses: true,
    });

    const connections: OrderBuyerDataRetentionConnectionResult[] = [];
    for (const source of sources) {
      const days = source.metadata.buyerDataRetentionDays;
      if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
        continue;
      }
      try {
        connections.push(await this.redactConnection(source.connectionId, days, now));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `order_buyer_data_retention_failed connection=${source.connectionId}: ${detail}`,
        );
      }
    }
    const redacted = connections.reduce((sum, entry) => sum + entry.redacted, 0);
    if (redacted > 0) {
      this.logger.log(`Removed buyer data from ${String(redacted)} order(s) past their retention period`);
    }
    return { connections, redacted };
  }

  private async redactConnection(
    sourceConnectionId: string,
    retentionDays: number,
    now: Date,
  ): Promise<OrderBuyerDataRetentionConnectionResult> {
    const anchorBefore = new Date(now.getTime() - retentionDays * MS_PER_DAY);
    const storePii = getEnvBoolean('OL_STORE_PII', true);
    let redacted = 0;
    let processed = 0;

    while (processed < BUYER_DATA_RETENTION_MAX_ORDERS_PER_CONNECTION) {
      const candidates = await this.repository.findBuyerDataRetentionCandidates({
        sourceConnectionId,
        anchorBefore,
        limit: BUYER_DATA_RETENTION_PAGE_SIZE,
      });
      if (candidates.length === 0) {
        return { sourceConnectionId, retentionDays, redacted, budgetExhausted: false };
      }
      for (const candidate of candidates) {
        const orderSnapshot = redactOrderSnapshotBuyerData(candidate.orderSnapshot);
        const done = await this.repository.redactBuyerData({
          internalOrderId: candidate.internalOrderId,
          orderSnapshot,
          searchText: deriveOrderSearchText(orderSnapshot, { storePii }),
        });
        if (done) {
          redacted += 1;
        }
      }
      processed += candidates.length;
      if (candidates.length < BUYER_DATA_RETENTION_PAGE_SIZE) {
        return { sourceConnectionId, retentionDays, redacted, budgetExhausted: false };
      }
    }
    return { sourceConnectionId, retentionDays, redacted, budgetExhausted: true };
  }
}
