/**
 * Mirakl Refunds
 *
 * Both refund halves of the Mirakl order source:
 *
 * - {@link MiraklRefundReader} reads the refunds already paid on an order
 *   (OR11, `order_lines[].refunds`, state `REFUNDED`) for core's
 *   `RefundSourceReader`. One observation per line refund: Mirakl gives each
 *   line its own refund id, and a refund counts only once the money moved.
 * - {@link MiraklRefundExecutor} sends a refund OpenLinker confirmed (OR28,
 *   `PUT /api/orders/refund`) for core's `RefundExecutor`. OPT-IN per
 *   connection (`config.refundsThroughMarketplace`); without it the order
 *   source has no `executeRefund` and core records refunds as made outside
 *   OpenLinker.
 *
 * Core asks for one amount per order; Mirakl refunds per order line, each with
 * a product part and a shipping part. The amount is spread over what is left
 * to refund: product parts first, line by line in order, then shipping parts.
 * More than is left is refused before anything is sent. A line's taxes (needed
 * by OR28 when the order carries them) are refunded in proportion to the part
 * refunded.
 *
 * Mirakl takes no idempotency key and keeps no note, so the guard is the host
 * cache: before the call the key is marked as being sent, after it the result
 * is stored. A retry finds the stored result and answers from it; a retry that
 * finds the "being sent" mark throws, because the earlier call may have moved
 * the money (core then blocks further attempts). Without a cache nothing is
 * sent. A refusal Mirakl answers with 4xx wrote nothing, so the mark is dropped
 * and the refusal is `denied`.
 *
 * OR28 creates the refunds in `WAITING_REFUND`; the operator pays them out
 * later, so a sent refund is `accepted`, never `refunded`.
 *
 * ## A refund OpenLinker sent is not observed again
 *
 * This source both reads refunds and sends them, so once Empik pays out a
 * refund OpenLinker sent, OR11 reports it as `REFUNDED` and the reader would
 * hand it to core as a NEW refund made outside OpenLinker: counted twice, and
 * relayed a second time to the order's copies in other channels. Core keys an
 * observation by the line refund id, which is not the id the executor records,
 * so the reader has to leave these out itself. The executor marks the line
 * refund ids it created (the ids in the OR28 answer, plus the ids that appear
 * on the order between its read before the call and a read after it) in the
 * host cache for {@link SENT_MARK_TTL_SECONDS}; the reader skips a marked id.
 * The executor refuses to send without a cache, so every refund it sent is
 * marked. A mark lost to a flushed cache would let that one refund be observed
 * again; the warning the executor logs when it cannot read the order back says
 * so for the case it can see.
 *
 * Concurrency: the check of the idempotency key and the "sending" mark are not
 * one atomic step. Two calls with one key at the same moment are kept apart by
 * core's per-order refund lock (`order:refund:{id}`), which every refund write
 * holds; this class relies on it rather than repeating it.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { createHash } from 'node:crypto';
import type {
  ExecuteRefundCommand,
  RefundExecutionResult,
  RefundReason,
  SourceRefundObservation,
} from '@openlinker/core/orders';
import type { CachePort } from '@openlinker/shared/cache';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { MiraklRefundInDoubtException } from '../../domain/exceptions/mirakl-refund-in-doubt.exception';
import type {
  MiraklOrder,
  MiraklOrderLine,
  MiraklTax,
} from '../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { describeMiraklFailure, readMiraklOrder } from './mirakl-order-reader';

const REFUND_PATH = '/api/orders/refund';
const REFUNDED_STATE = 'REFUNDED';
const AMOUNT = /^\d+(\.\d{1,2})?$/;
/** How long a refund key is remembered: well past any retry of the same refund. */
const KEY_TTL_SECONDS = 60 * 60 * 24 * 90;
/** How long a sent line refund is remembered: well past any payout delay. */
const SENT_MARK_TTL_SECONDS = 60 * 60 * 24 * 180;

interface MiraklRefundRequestLine {
  order_line_id: string;
  amount: number;
  shipping_amount: number;
  currency_iso_code: string;
  reason_code: string;
  taxes?: Array<{ code: string; amount: number }>;
  shipping_taxes?: Array<{ code: string; amount: number }>;
}

interface MiraklRefundResponse {
  readonly refunds?: ReadonlyArray<{
    readonly refund_id?: string;
    readonly order_refund_id?: string;
  }>;
}

type StoredRefund =
  | { readonly state: 'sending' }
  | { readonly state: 'sent'; readonly providerRefundId: string | null };

function toCents(amount: number | string | undefined): number {
  const value = typeof amount === 'string' ? Number(amount) : amount ?? 0;
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function toAmount(cents: number): number {
  return Math.round(cents) / 100;
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function refundStateOf(refund: { refund_state?: string; state?: string }): string | undefined {
  return refund.refund_state ?? refund.state;
}

function denied(message: string): RefundExecutionResult {
  return { outcome: 'denied', providerRefundId: null, refundedAt: null, providerMessage: message };
}

/**
 * Every refund already on the line, whatever its state: all four OR11 states
 * (`WAITING_REFUND_TAX_CONFIRMATION`, `WAITING_REFUND`, `WAITING_REFUND_PAYMENT`,
 * `REFUNDED`) are money promised to the buyer, and Mirakl has no refused state.
 */
function sumRefunded(line: MiraklOrderLine, part: 'amount' | 'shipping_amount'): number {
  return (line.refunds ?? []).reduce((sum, refund) => sum + toCents(refund[part]), 0);
}

/** Taxes refunded in proportion to the part of the line refunded. */
function proportionalTaxes(
  taxes: readonly MiraklTax[] | undefined,
  refundedCents: number,
  baseCents: number
): Array<{ code: string; amount: number }> | undefined {
  const withAmount = (taxes ?? []).filter(
    (tax): tax is MiraklTax & { code: string } =>
      typeof tax.code === 'string' && toCents(tax.amount) > 0
  );
  if (withAmount.length === 0 || refundedCents <= 0 || baseCents <= 0) {
    return undefined;
  }
  return withAmount.map((tax) => ({
    code: tax.code,
    amount: toAmount(Math.floor((toCents(tax.amount) * refundedCents) / baseCents)),
  }));
}

/** Cache key marking a line refund OpenLinker sent itself. */
function sentMarkKey(connectionId: string, lineRefundId: string): string {
  return `mirakl:refund-sent:${connectionId}:${lineRefundId}`;
}

/** The ids of every refund already on the order's lines. */
function lineRefundIds(order: MiraklOrder): Set<string> {
  const ids = new Set<string>();
  for (const line of order.order_lines ?? []) {
    for (const refund of line.refunds ?? []) {
      if (refund.id) {
        ids.add(refund.id);
      }
    }
  }
  return ids;
}

export class MiraklRefundReader {
  private readonly logger = new Logger(MiraklRefundReader.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly cache: CachePort | undefined
  ) {}

  async listRefunds(input: { externalOrderId: string }): Promise<SourceRefundObservation[]> {
    const order = await readMiraklOrder(this.httpClient, input.externalOrderId);
    if (!order) {
      return [];
    }
    const observations: SourceRefundObservation[] = [];
    for (const line of order.order_lines ?? []) {
      for (const refund of line.refunds ?? []) {
        if (!refund.id || refundStateOf(refund) !== REFUNDED_STATE) {
          continue;
        }
        if (await this.sentByOpenLinker(refund.id)) {
          continue;
        }
        observations.push({
          externalRefundId: refund.id,
          amount: formatCents(toCents(refund.amount) + toCents(refund.shipping_amount)),
          currency: refund.currency_iso_code ?? order.currency_iso_code ?? '',
          // The platform's own instant, or none; never our clock.
          occurredAt: refund.transaction_date ? new Date(refund.transaction_date) : null,
        });
      }
    }
    return observations;
  }

  private async sentByOpenLinker(lineRefundId: string): Promise<boolean> {
    if (!this.cache) {
      return false;
    }
    const marked = await this.cache.get<true>(sentMarkKey(this.connectionId, lineRefundId));
    if (marked === true) {
      this.logger.debug(
        `Skipping refund ${lineRefundId}: OpenLinker sent it (connection: ${this.connectionId})`
      );
      return true;
    }
    return false;
  }
}

export class MiraklRefundExecutor {
  private readonly logger = new Logger(MiraklRefundExecutor.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly brand: string,
    private readonly reasonCodes: Readonly<Record<RefundReason, string>>,
    private readonly cache: CachePort | undefined
  ) {}

  async executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    if (command.externalOrderId === null || command.externalOrderId.trim() === '') {
      return denied(`The refund names no ${this.brand} order to refund against.`);
    }
    if (command.idempotencyKey.trim().length === 0) {
      return denied('The refund carries no idempotency key, so it was not sent.');
    }
    if (!AMOUNT.test(command.amount) || toCents(command.amount) <= 0) {
      return denied(
        `The amount ${command.amount} is not a positive amount with at most two decimals.`
      );
    }
    if (!this.cache) {
      return denied(
        `${this.brand} takes no idempotency key and this host has no cache to remember one; refund in the ${this.brand} panel.`
      );
    }

    const cacheKey = this.cacheKey(command.idempotencyKey);
    const stored = await this.cache.get<StoredRefund>(cacheKey);
    if (stored?.state === 'sent') {
      this.logger.warn(
        `Refund ${cacheKey} was already sent to ${this.brand} order ${command.externalOrderId}; ` +
          `answering from it (connection: ${this.connectionId})`
      );
      return this.accepted(stored.providerRefundId);
    }
    if (stored?.state === 'sending') {
      throw new MiraklRefundInDoubtException(
        command.externalOrderId,
        this.connectionId,
        'an earlier attempt with the same key did not finish; check the order before refunding again'
      );
    }

    const order = await readMiraklOrder(this.httpClient, command.externalOrderId);
    if (!order) {
      return denied(`${this.brand} order ${command.externalOrderId} does not exist.`);
    }
    const currency = command.currency.toUpperCase();
    const orderCurrency = (order.currency_iso_code ?? '').toUpperCase();
    if (orderCurrency !== '' && currency !== orderCurrency) {
      return denied(`The refund is in ${currency} but the order is in ${orderCurrency}.`);
    }

    const plan = this.plan(
      order,
      toCents(command.amount),
      command.reason,
      orderCurrency || currency
    );
    if (plan.kind === 'too-much') {
      return denied(
        `The order has ${formatCents(plan.leftCents)} ${currency} left to refund, less than the ${command.amount} asked.`
      );
    }

    await this.cache.set<StoredRefund>(cacheKey, { state: 'sending' }, KEY_TTL_SECONDS);
    let response: MiraklRefundResponse;
    try {
      ({ data: response } = await this.httpClient.put<MiraklRefundResponse>(REFUND_PATH, {
        order_tax_mode: order.order_tax_mode ?? 'TAX_INCLUDED',
        refunds: plan.lines,
      }));
    } catch (error) {
      if (
        error instanceof MiraklApiException &&
        error.statusCode !== undefined &&
        error.statusCode >= 400 &&
        error.statusCode < 500 &&
        error.statusCode !== 429
      ) {
        // A 4xx validation answer wrote nothing: the key is free again.
        await this.cache.delete(cacheKey);
        return denied(
          `${this.brand} refused the refund: ${describeMiraklFailure(error.statusCode, error.miraklCode)}`
        );
      }
      throw error;
    }

    const providerRefundId =
      response?.refunds?.find((refund) => refund.order_refund_id)?.order_refund_id ??
      response?.refunds?.find((refund) => refund.refund_id)?.refund_id ??
      null;
    await this.markSentLineRefunds(command.externalOrderId, lineRefundIds(order), response);
    await this.cache.set<StoredRefund>(
      cacheKey,
      { state: 'sent', providerRefundId },
      KEY_TTL_SECONDS
    );
    return this.accepted(providerRefundId);
  }

  private plan(
    order: MiraklOrder,
    requestedCents: number,
    reason: RefundReason,
    currency: string
  ): { kind: 'ok'; lines: MiraklRefundRequestLine[] } | { kind: 'too-much'; leftCents: number } {
    const lines = (order.order_lines ?? []).filter(
      (line): line is MiraklOrderLine & { order_line_id: string } =>
        typeof line.order_line_id === 'string' && line.order_line_id !== ''
    );
    const left = lines.map((line) => ({
      line,
      product: Math.max(0, toCents(line.price) - sumRefunded(line, 'amount')),
      shipping: Math.max(0, toCents(line.shipping_price) - sumRefunded(line, 'shipping_amount')),
    }));
    const leftCents = left.reduce((sum, l) => sum + l.product + l.shipping, 0);
    if (requestedCents > leftCents) {
      return { kind: 'too-much', leftCents };
    }

    let remaining = requestedCents;
    const take = left.map((l) => {
      const product = Math.min(remaining, l.product);
      remaining -= product;
      return { ...l, takeProduct: product, takeShipping: 0 };
    });
    for (const l of take) {
      const shipping = Math.min(remaining, l.shipping);
      remaining -= shipping;
      l.takeShipping = shipping;
    }

    const reasonCode = this.reasonCodes[reason];
    const requestLines = take
      .filter((l) => l.takeProduct + l.takeShipping > 0)
      .map((l): MiraklRefundRequestLine => {
        const taxes = proportionalTaxes(l.line.taxes, l.takeProduct, toCents(l.line.price));
        const shippingTaxes = proportionalTaxes(
          l.line.shipping_taxes,
          l.takeShipping,
          toCents(l.line.shipping_price)
        );
        return {
          order_line_id: l.line.order_line_id,
          amount: toAmount(l.takeProduct),
          shipping_amount: toAmount(l.takeShipping),
          currency_iso_code: currency,
          reason_code: reasonCode,
          ...(taxes ? { taxes } : {}),
          ...(shippingTaxes ? { shipping_taxes: shippingTaxes } : {}),
        };
      });
    return { kind: 'ok', lines: requestLines };
  }

  /**
   * Marks the line refunds this call created, so the reader does not report
   * them as refunds made outside OpenLinker once Empik pays them out. Never
   * throws: the money is already on its way, and failing here would make core
   * record an executed refund as unknown.
   */
  private async markSentLineRefunds(
    externalOrderId: string,
    before: ReadonlySet<string>,
    response: MiraklRefundResponse | undefined
  ): Promise<void> {
    const created = new Set<string>();
    for (const refund of response?.refunds ?? []) {
      if (refund.refund_id) {
        created.add(refund.refund_id);
      }
    }
    try {
      const after = await readMiraklOrder(this.httpClient, externalOrderId);
      for (const id of after ? lineRefundIds(after) : []) {
        if (!before.has(id)) {
          created.add(id);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Could not read ${this.brand} order ${externalOrderId} back after a refund; ` +
          `only the ids in the refund answer are marked as sent by OpenLinker ` +
          `(connection: ${this.connectionId}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (created.size === 0) {
      this.logger.warn(
        `No line refund id found for the refund on ${this.brand} order ${externalOrderId}; ` +
          `once paid out it may be recorded a second time (connection: ${this.connectionId})`
      );
      return;
    }
    for (const id of created) {
      try {
        await this.cache?.set<true>(
          sentMarkKey(this.connectionId, id),
          true,
          SENT_MARK_TTL_SECONDS
        );
      } catch (error) {
        this.logger.warn(
          `Could not mark refund ${id} as sent by OpenLinker; once paid out it may be ` +
            `recorded a second time (connection: ${this.connectionId}): ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  private accepted(providerRefundId: string | null): RefundExecutionResult {
    return {
      outcome: 'accepted',
      providerRefundId,
      refundedAt: null,
      providerMessage: `Sent to ${this.brand}; the refund is paid out by ${this.brand}.`,
    };
  }

  private cacheKey(idempotencyKey: string): string {
    const hash = createHash('sha256').update(idempotencyKey).digest('hex');
    return `mirakl:refund:${this.connectionId}:${hash}`;
  }
}
