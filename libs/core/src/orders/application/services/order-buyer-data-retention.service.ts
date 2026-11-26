/**
 * Order Buyer Data Retention Service (#4178)
 *
 * See `IOrderBuyerDataRetentionService`. One pass reads, per source connection
 * that declares `buyerDataRetentionDays`, the orders past their retention
 * anchor (frontier-as-query: a redacted row leaves the set) and redacts them
 * one by one, at most `MAX_ORDERS_PER_CONNECTION` per run, so a backlog drains
 * over several runs instead of one long transaction.
 *
 * For each order it first clears the recipient on the order's buyer-email and
 * document-email delivery records, then marks the order redacted, so a failure
 * leaves the order a candidate for the next run. After the orders it clears the customer
 * projections (email, names, street address) of customers last seen through
 * this source before the same cutoff.
 *
 * Connections are found through `listCapabilityAdapters('OrderSource', lazy,
 * all statuses)`: no adapter is built, and a disabled connection's old orders
 * are still cleaned - the limit binds whether or not the connection is in use.
 *
 * @module application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_PROJECTION_SERVICE_TOKEN,
  type ICustomerProjectionService,
} from '@openlinker/core/customers';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  DOCUMENT_EMAIL_DELIVERY_SERVICE_TOKEN,
  type IDocumentEmailDeliveryService,
} from '@openlinker/core/sales-documents';
import { getEnvBoolean } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';

import { redactOrderSnapshotBuyerData } from '../../domain/order-buyer-data-redaction';
import { deriveOrderSearchText } from '../../domain/order-search-text';
import { BuyerEmailDeliveryRepositoryPort } from '../../domain/ports/buyer-email-delivery-repository.port';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import {
  MIN_BUYER_DATA_RETENTION_DAYS,
  type OrderBuyerDataRetentionCandidate,
  type OrderBuyerDataRetentionConnectionResult,
  type OrderBuyerDataRetentionRunResult,
} from '../../domain/types/order-buyer-data-retention.types';
import {
  BUYER_EMAIL_DELIVERY_REPOSITORY_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
} from '../../orders.tokens';
import type { IOrderBuyerDataRetentionService } from './order-buyer-data-retention.service.interface';

export const BUYER_DATA_RETENTION_PAGE_SIZE = 200;
export const BUYER_DATA_RETENTION_MAX_ORDERS_PER_CONNECTION = 2000;
export const BUYER_DATA_RETENTION_CUSTOMER_BATCH = 200;
export const BUYER_DATA_RETENTION_MAX_CUSTOMERS_PER_CONNECTION = 2000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class OrderBuyerDataRetentionService implements IOrderBuyerDataRetentionService {
  private readonly logger = new Logger(OrderBuyerDataRetentionService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(BUYER_EMAIL_DELIVERY_REPOSITORY_TOKEN)
    private readonly buyerEmailDeliveries: BuyerEmailDeliveryRepositoryPort,
    @Inject(DOCUMENT_EMAIL_DELIVERY_SERVICE_TOKEN)
    private readonly documentEmailDeliveries: IDocumentEmailDeliveryService,
    @Inject(CUSTOMER_PROJECTION_SERVICE_TOKEN)
    private readonly customerProjections: ICustomerProjectionService
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
      if (
        typeof days !== 'number' ||
        !Number.isFinite(days) ||
        days < MIN_BUYER_DATA_RETENTION_DAYS
      ) {
        continue;
      }
      try {
        connections.push(await this.redactConnection(source.connectionId, days, now));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `order_buyer_data_retention_failed connection=${source.connectionId}: ${detail}`
        );
      }
    }
    const redacted = connections.reduce((sum, entry) => sum + entry.redacted, 0);
    if (redacted > 0) {
      this.logger.log(
        `Removed buyer data from ${String(redacted)} order(s) past their retention period`
      );
    }
    return { connections, redacted };
  }

  private async redactConnection(
    sourceConnectionId: string,
    retentionDays: number,
    now: Date
  ): Promise<OrderBuyerDataRetentionConnectionResult> {
    const anchorBefore = new Date(now.getTime() - retentionDays * MS_PER_DAY);
    const storePii = getEnvBoolean('OL_STORE_PII', true);
    let redacted = 0;
    let processed = 0;

    // Stays true unless the candidate set runs out before the per-run cap.
    let orderBudgetSpent = true;
    // Orders that failed this run. They stay candidates (the frontier is
    // oldest first), so a page made only of them means nothing else can be
    // reached this run; the loop stops instead of re-reading them.
    const failedIds = new Set<string>();
    while (processed < BUYER_DATA_RETENTION_MAX_ORDERS_PER_CONNECTION) {
      const candidates = await this.repository.findBuyerDataRetentionCandidates({
        sourceConnectionId,
        anchorBefore,
        limit: BUYER_DATA_RETENTION_PAGE_SIZE,
      });
      if (candidates.length > 0 && candidates.every((candidate) => failedIds.has(candidate.internalOrderId))) {
        break;
      }
      for (const candidate of candidates) {
        if (failedIds.has(candidate.internalOrderId)) continue;
        // One order that cannot be redacted must not stop the others: the
        // frontier is oldest first, so a rethrow would put it at the head of
        // every later run and stall retention for the whole connection.
        try {
          if (await this.redactOrder(candidate, storePii)) {
            redacted += 1;
          }
        } catch (error) {
          failedIds.add(candidate.internalOrderId);
          const detail = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `order_buyer_data_retention_order_failed order=${candidate.internalOrderId} ` +
              `connection=${sourceConnectionId}: ${detail}`
          );
        }
      }
      processed += candidates.length;
      if (candidates.length < BUYER_DATA_RETENTION_PAGE_SIZE) {
        orderBudgetSpent = false;
        break;
      }
    }

    const customers = await this.redactCustomers(sourceConnectionId, anchorBefore);
    return {
      sourceConnectionId,
      retentionDays,
      redacted,
      failed: failedIds.size,
      customersRedacted: customers.redacted,
      budgetExhausted: orderBudgetSpent || customers.budgetExhausted,
    };
  }

  /**
   * Recipients first: the order's marker takes it out of the candidate set, so
   * anything cleared after it would be left behind for good if that write
   * failed. Both clears are idempotent and retried with the order.
   */
  private async redactOrder(
    candidate: OrderBuyerDataRetentionCandidate,
    storePii: boolean
  ): Promise<boolean> {
    await this.buyerEmailDeliveries.clearRecipientsForOrder(candidate.internalOrderId);
    await this.documentEmailDeliveries.clearRecipientsForOrder(candidate.internalOrderId);
    const orderSnapshot = redactOrderSnapshotBuyerData(candidate.orderSnapshot);
    return this.repository.redactBuyerData({
      internalOrderId: candidate.internalOrderId,
      orderSnapshot,
      searchText: deriveOrderSearchText(orderSnapshot, { storePii }),
    });
  }

  /**
   * The customer projections an order of this source last touched. Keyed by
   * when the customer was last seen, not by order, so a customer who orders
   * again keeps their data until that order is past the period too.
   */
  private async redactCustomers(
    sourceConnectionId: string,
    lastSeenBefore: Date
  ): Promise<{ redacted: number; budgetExhausted: boolean }> {
    let redacted = 0;
    while (redacted < BUYER_DATA_RETENTION_MAX_CUSTOMERS_PER_CONNECTION) {
      const batch = await this.customerProjections.redactPersonalDataLastSeenBefore({
        sourceConnectionId,
        lastSeenBefore,
        limit: BUYER_DATA_RETENTION_CUSTOMER_BATCH,
      });
      redacted += batch;
      if (batch < BUYER_DATA_RETENTION_CUSTOMER_BATCH) {
        return { redacted, budgetExhausted: false };
      }
    }
    return { redacted, budgetExhausted: true };
  }
}
