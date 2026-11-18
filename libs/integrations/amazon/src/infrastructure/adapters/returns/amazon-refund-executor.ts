/**
 * Amazon Refund Executor (#4184)
 *
 * `RefundExecutor` for seller-fulfilled Amazon orders, opt-in per connection
 * (`refundsEnabled`). Amazon refunds such an order through the payment
 * adjustment feed (`POST_FLAT_FILE_PAYMENT_ADJUSTMENT_DATA`), one row per order
 * item, so the amount is split over the returned items first
 * (`allocateAmazonRefund`).
 *
 * The three obligations of the port, in Amazon's terms:
 *
 *   1. One submission per idempotency key. The key's state is kept in the
 *      host cache: `submitting` is written before the feed is created and the
 *      feed id after, so a retry looks the feed up instead of submitting a
 *      second one, and a retry that finds `submitting` (a run that died
 *      between the two writes) throws: Amazon may have the feed, so the
 *      outcome is unknown. Without a cache this cannot be guaranteed, and
 *      core only retries after a terminal `denied` anyway.
 *   2. `refundedAt` is Amazon's `processingEndTime` of the feed, never this
 *      process's clock.
 *   3. `denied` only when Amazon moved nothing: every row refused, the feed
 *      cancelled or failed, or the request refused before anything was sent
 *      (an Amazon-fulfilled order, another currency, an amount larger than the
 *      items). A feed that refunded some rows and refused others is thrown, an
 *      outcome the operator resolves by hand.
 *
 * Amazon processes a feed in minutes. This waits up to
 * `AMAZON_REFUND_FEED_WAIT_MS` for the result; a feed still running after that
 * is reported `accepted` with the feed id as the provider reference.
 *
 * Amounts are VAT-inclusive (`item-price-adj`), as European Amazon prices are.
 * Not verified on a live account (#4184 research criterion): the feed's column
 * set and whether partial amounts are accepted.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/returns
 */
import type { ExecuteRefundCommand, RefundExecutionResult, RefundReason } from '@openlinker/core/orders';
import type { CachePort } from '@openlinker/shared';

import { allocateAmazonRefund, type AmazonRefundOrderItem } from '../../../domain/policies/amazon-refund-allocation.policy';
import type { AmazonOrder } from '../../../domain/types/amazon-order.types';
import type { AmazonFeedsClient } from '../../http/amazon-feeds.client';
import { writeAmazonFlatFile } from '../../mappers/amazon-flat-file';
import { readAmazonFeedProcessingReport } from '../../mappers/amazon-feed-processing-report';
import type { AmazonReturnReader } from './amazon-return-reader';

export const AMAZON_PAYMENT_ADJUSTMENT_FEED_TYPE = 'POST_FLAT_FILE_PAYMENT_ADJUSTMENT_DATA';
const FEED_CONTENT_TYPE = 'text/tab-separated-values; charset=UTF-8';
export const AMAZON_REFUND_FEED_WAIT_MS = 40_000;
const FEED_POLL_INTERVAL_MS = 5_000;
const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;

const FEED_HEADERS = [
  'order-id',
  'order-item-id',
  'adjustment-reason-code',
  'currency',
  'item-price-adj',
  'item-tax-adj',
  'shipping-price-adj',
  'shipping-tax-adj',
] as const;

type KeyState = { readonly state: 'submitting' } | { readonly state: 'submitted'; readonly feedId: string };

export interface AmazonRefundExecutorDeps {
  readonly connectionId: string;
  readonly marketplaceIds: readonly string[];
  readonly feeds: AmazonFeedsClient;
  readonly returns: AmazonReturnReader;
  readonly readOrder: (orderId: string) => Promise<AmazonOrder>;
  readonly cache?: CachePort;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export class AmazonRefundExecutor {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: AmazonRefundExecutorDeps) {
    this.sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? ((): number => Date.now());
  }

  async executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    const key = `amazon:refund:${this.deps.connectionId}:${command.idempotencyKey}`;
    const known = await this.readKey(key);
    if (known?.state === 'submitted') {
      return this.awaitFeed(known.feedId);
    }
    if (known?.state === 'submitting') {
      throw new Error(
        `A refund under this key was being sent to Amazon when its run stopped; check Seller Central before retrying ` +
          `(connection: ${this.deps.connectionId})`,
      );
    }

    if (command.externalOrderId === null) {
      return denied('the return names no Amazon order to refund');
    }
    const order = await this.deps.readOrder(command.externalOrderId);
    if (order.fulfillment?.fulfilledBy === 'AMAZON') {
      return denied('Amazon refunds the orders it fulfils itself');
    }
    const items = toRefundItems(order, command.currency);
    if (items === null) {
      return denied(`the Amazon order is not in ${command.currency}`);
    }
    const returned =
      command.externalReturnId === null ? null : await this.deps.returns.cached(command.externalReturnId);
    const allocation = allocateAmazonRefund(
      toMinor(command.amount),
      items,
      returned === null ? null : returned.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
    );
    if (!allocation.ok) {
      return denied(allocation.reason);
    }

    const reasonCode = adjustmentReason(command.reason, command.externalReturnId !== null);
    const content = writeAmazonFlatFile(
      FEED_HEADERS,
      allocation.parts.map((part) => [
        order.orderId,
        part.orderItemId,
        reasonCode,
        command.currency,
        fromMinor(part.amountMinor),
        '0.00',
        '0.00',
        '0.00',
      ]),
    );

    let documentId: string;
    try {
      documentId = await this.deps.feeds.uploadFeedDocument(content, FEED_CONTENT_TYPE);
    } catch (error) {
      // Nothing is submitted until the feed is created: no money can have moved.
      return denied(`the refund could not be sent to Amazon: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.writeKey(key, { state: 'submitting' });
    // A failure here is thrown on purpose: Amazon may have created the feed.
    const feedId = await this.deps.feeds.createFeed(
      AMAZON_PAYMENT_ADJUSTMENT_FEED_TYPE,
      [order.salesChannel.marketplaceId ?? this.deps.marketplaceIds[0]],
      documentId,
    );
    await this.writeKey(key, { state: 'submitted', feedId });
    return this.awaitFeed(feedId);
  }

  private async awaitFeed(feedId: string): Promise<RefundExecutionResult> {
    const deadline = this.now() + AMAZON_REFUND_FEED_WAIT_MS;
    for (;;) {
      const feed = await this.deps.feeds.getFeed(feedId);
      if (feed.processingStatus === 'CANCELLED' || feed.processingStatus === 'FATAL') {
        return { ...denied(`Amazon did not process the refund feed (${feed.processingStatus})`), providerRefundId: feedId };
      }
      if (feed.processingStatus === 'DONE') {
        return this.readResult(feedId, feed.resultFeedDocumentId, feed.processingEndTime);
      }
      if (this.now() + FEED_POLL_INTERVAL_MS > deadline) {
        return { outcome: 'accepted', providerRefundId: feedId, refundedAt: null, providerMessage: null };
      }
      await this.sleep(FEED_POLL_INTERVAL_MS);
    }
  }

  private async readResult(
    feedId: string,
    resultDocumentId: string | undefined,
    processingEndTime: string | undefined,
  ): Promise<RefundExecutionResult> {
    if (resultDocumentId === undefined) {
      throw new Error(`Amazon finished refund feed ${feedId} without a processing report; check Seller Central`);
    }
    const summary = readAmazonFeedProcessingReport(await this.deps.feeds.downloadResult(resultDocumentId));
    if (summary.successful === 0 && summary.errors.length > 0) {
      return { outcome: 'denied', providerRefundId: feedId, refundedAt: null, providerMessage: summary.errors[0] };
    }
    if (summary.errors.length === 0 && summary.successful !== null && summary.successful > 0) {
      const at = processingEndTime ? new Date(processingEndTime) : null;
      return {
        outcome: 'refunded',
        providerRefundId: feedId,
        refundedAt: at !== null && !Number.isNaN(at.getTime()) ? at : null,
        providerMessage: null,
      };
    }
    throw new Error(
      `Amazon refunded only part of refund feed ${feedId} or its report could not be read` +
        (summary.errors[0] ? `: ${summary.errors[0]}` : '') +
        '; check Seller Central',
    );
  }

  private async readKey(key: string): Promise<KeyState | null> {
    if (this.deps.cache === undefined) return null;
    return (await this.deps.cache.get<KeyState>(key)) ?? null;
  }

  private async writeKey(key: string, state: KeyState): Promise<void> {
    await this.deps.cache?.set(key, state, KEY_TTL_SECONDS);
  }
}

function denied(message: string): RefundExecutionResult {
  return { outcome: 'denied', providerRefundId: null, refundedAt: null, providerMessage: message };
}

/** The order's items with their unit prices in minor units, or `null` when a price is in another currency. */
function toRefundItems(order: AmazonOrder, currency: string): AmazonRefundOrderItem[] | null {
  const items: AmazonRefundOrderItem[] = [];
  for (const item of order.orderItems) {
    const price = item.product.price?.unitPrice;
    if (price !== undefined && price.currencyCode !== currency) {
      return null;
    }
    items.push({
      orderItemId: item.orderItemId,
      sku: item.product.sellerSku ?? null,
      unitPriceMinor: price !== undefined ? toMinor(price.amount) : 0,
      quantity: item.quantityOrdered,
    });
  }
  return items;
}

function adjustmentReason(reason: RefundReason, forReturn: boolean): string {
  if (reason === 'wrong_item') return 'DifferentItem';
  return forReturn ? 'CustomerReturn' : 'GeneralAdjustment';
}

function toMinor(amount: string): number {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
}

function fromMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}
