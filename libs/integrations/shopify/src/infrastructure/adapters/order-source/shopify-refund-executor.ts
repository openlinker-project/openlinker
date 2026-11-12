/**
 * Shopify Refund Executor
 *
 * The money half of `RefundExecutor` (case C20): a refund OpenLinker confirms
 * becomes a Shopify `refundCreate` of money only (no line items, nothing
 * restocked - the return custody flow owns stock), against the order's own
 * payment transactions. With Shopify Payments that MOVES the buyer's money; on
 * a `manual` gateway it records a refund the merchant pays out themselves.
 *
 * OPT-IN per connection (`config.refundsThroughShopify: true`, see the
 * factory). Without it the order source is not a `RefundExecutor` at all and
 * core keeps recording refunds as made out of band - which is what an operator
 * who already refunded in the Shopify admin expects when they confirm in
 * OpenLinker. Turning it on changes what "confirm refund" does.
 *
 * Never more than asked, never more than Shopify allows:
 *   - the amount must be a positive decimal with at most two places, in the
 *     order's currency, with shop and presentment currency equal (a
 *     multi-currency order is refused rather than converted);
 *   - it is spread over `suggestedRefund(suggestFullRefund: true)`'s
 *     transactions, each capped at its own `maximumRefundableSet`; more than
 *     their total is refused before anything is sent.
 *
 * Idempotency, twice over: the caller's key goes to `refundCreate` as
 * `@idempotent(key:)` (hashed to a fixed length), and a marker derived from it
 * is written into the refund note. Before sending, the order's refunds are read
 * and one carrying the marker is answered from - the "already refunded is a
 * success" rule - so a retry after a lost answer does not refund again even
 * when Shopify's key window has passed.
 *
 * Outcomes (core's three, RefundExecutor obligations):
 *   - `denied`: refused BEFORE anything was sent, a `userErrors` answer (Shopify
 *     wrote nothing), or a refund whose every transaction failed;
 *   - `refunded`: every transaction `SUCCESS`, `refundedAt` = Shopify's own
 *     `processedAt` (or the refund's `createdAt`), never our clock;
 *   - `accepted`: a transaction still `PENDING`;
 *   - THROW for anything indeterminate: transport errors, a throttle, or a mix
 *     of succeeded and failed transactions (money partly moved).
 *
 * Not done: linking the refund to a Shopify return (`returnProcess`), refunding
 * shipping or lines as such, or currencies with other than two decimals (such
 * a currency is refused before anything is sent).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-source
 */
import { createHash } from 'node:crypto';

import type { ExecuteRefundCommand, RefundExecutionResult } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyRefundInDoubtException } from '../../../domain/exceptions/shopify-refund-in-doubt.exception';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type { ShopifyConnection } from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';

const AMOUNT = /^\d+(\.\d{1,2})?$/;

interface PresentmentMoney {
  readonly presentmentMoney: { readonly amount: string; readonly currencyCode: string };
}

interface RefundNode {
  readonly id: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly transactions: ShopifyConnection<{
    readonly status: string;
    readonly processedAt: string | null;
  }>;
}

interface RefundTargetQuery {
  readonly order: {
    readonly id: string;
    readonly currencyCode: string;
    readonly presentmentCurrencyCode: string;
    readonly refunds: readonly RefundNode[];
    readonly suggestedRefund: {
      readonly suggestedTransactions: ReadonlyArray<{
        readonly gateway: string;
        readonly kind: string;
        readonly parentTransaction: { readonly id: string } | null;
        readonly maximumRefundableSet: PresentmentMoney | null;
      }>;
    } | null;
  } | null;
}

interface RefundCreatePayload {
  readonly refund: RefundNode | null;
}

const REFUND_FIELDS = `id note createdAt transactions(first: 20) { nodes { status processedAt } }`;

const REFUND_TARGET_QUERY = `query OlRefundTarget($id: ID!) {
  order(id: $id) {
    id currencyCode presentmentCurrencyCode
    refunds(first: 50) { ${REFUND_FIELDS} }
    suggestedRefund(suggestFullRefund: true) {
      suggestedTransactions {
        gateway kind
        parentTransaction { id }
        maximumRefundableSet { presentmentMoney { amount currencyCode } }
      }
    }
  }
}`;

const REFUND_CREATE_MUTATION = `mutation OlRefundCreate($input: RefundInput!, $key: String!) {
  refundCreate(input: $input) @idempotent(key: $key) {
    refund { ${REFUND_FIELDS} }
    userErrors { field message }
  }
}`;

function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function denied(message: string): RefundExecutionResult {
  return { outcome: 'denied', providerRefundId: null, refundedAt: null, providerMessage: message };
}

export class ShopifyRefundExecutor {
  private readonly logger = new Logger(ShopifyRefundExecutor.name);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly connectionId: string,
  ) {}

  async executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    if (command.externalOrderId === null || !/^\d+$/.test(command.externalOrderId)) {
      return denied('The return names no Shopify order to refund against.');
    }
    if (command.idempotencyKey.trim().length === 0) {
      return denied('The refund carries no idempotency key, so it was not sent.');
    }
    if (!AMOUNT.test(command.amount) || toCents(command.amount) <= 0) {
      return denied(`The amount ${command.amount} is not a positive amount with at most two decimals.`);
    }

    const key = createHash('sha256').update(command.idempotencyKey).digest('hex');
    const marker = `[ol:${key.slice(0, 16)}]`;
    const { order } = await this.client.query<RefundTargetQuery>(REFUND_TARGET_QUERY, {
      id: toShopifyGid('Order', command.externalOrderId),
    });
    if (order === null) {
      return denied(`Shopify order ${command.externalOrderId} does not exist.`);
    }

    const previous = order.refunds.find(
      (r) => (r.note ?? '').includes(marker) && !this.allFailed(r),
    );
    if (previous !== undefined) {
      this.logger.warn(
        `Refund for key ${marker} already exists on Shopify order ${command.externalOrderId} ` +
          `(${previous.id}); answering from it (connection: ${this.connectionId})`,
      );
      return this.resultOf(previous, command.externalOrderId);
    }

    const currency = command.currency.toUpperCase();
    if (order.currencyCode !== order.presentmentCurrencyCode) {
      return denied(
        `The order was paid in ${order.presentmentCurrencyCode} but the shop's currency is ${order.currencyCode}; ` +
          'refund it in the Shopify admin.',
      );
    }
    if (currency !== order.currencyCode) {
      return denied(`The refund is in ${currency} but the order is in ${order.currencyCode}.`);
    }

    const parents = (order.suggestedRefund?.suggestedTransactions ?? [])
      .map((t) => ({
        gateway: t.gateway,
        parentId: t.parentTransaction?.id ?? null,
        maxCents: t.maximumRefundableSet === null ? 0 : toCents(t.maximumRefundableSet.presentmentMoney.amount),
      }))
      .filter((t): t is { gateway: string; parentId: string; maxCents: number } => t.parentId !== null && t.maxCents > 0);
    const requested = toCents(command.amount);
    const refundable = parents.reduce((sum, t) => sum + t.maxCents, 0);
    if (requested > refundable) {
      return denied(
        `The order has ${fromCents(refundable)} ${currency} left to refund, less than the ${command.amount} asked.`,
      );
    }

    const transactions: Array<Record<string, unknown>> = [];
    let remaining = requested;
    for (const parent of parents) {
      if (remaining === 0) {
        break;
      }
      const take = Math.min(remaining, parent.maxCents);
      transactions.push({
        orderId: order.id,
        parentId: parent.parentId,
        gateway: parent.gateway,
        kind: 'REFUND',
        amount: fromCents(take),
      });
      remaining -= take;
    }

    const note = [`OpenLinker refund ${marker}`, command.reason, command.note ?? '']
      .filter((part) => part.trim().length > 0)
      .join(' - ');
    let payload: RefundCreatePayload;
    try {
      payload = await this.client.mutate<RefundCreatePayload>(
        REFUND_CREATE_MUTATION,
        { input: { orderId: order.id, note, notify: false, transactions }, key: `ol-refund-${key.slice(0, 48)}` },
        'refundCreate',
      );
    } catch (error) {
      if (error instanceof ShopifyUserErrorsException && !error.isRateLimited()) {
        return denied(`Shopify refused the refund: ${error.message}`);
      }
      throw error;
    }
    if (payload.refund === null) {
      throw new ShopifyRefundInDoubtException(
        command.externalOrderId,
        this.connectionId,
        'Shopify answered without a refund; check the order before refunding again',
      );
    }
    return this.resultOf(payload.refund, command.externalOrderId);
  }

  private allFailed(refund: RefundNode): boolean {
    const nodes = refund.transactions.nodes;
    return nodes.length > 0 && nodes.every((t) => t.status === 'FAILURE' || t.status === 'ERROR');
  }

  private resultOf(refund: RefundNode, externalOrderId: string): RefundExecutionResult {
    const statuses = refund.transactions.nodes.map((t) => t.status);
    const providerRefundId = fromShopifyGid(refund.id);
    if (this.allFailed(refund)) {
      return { outcome: 'denied', providerRefundId, refundedAt: null, providerMessage: 'Every refund transaction failed.' };
    }
    if (statuses.some((s) => s === 'FAILURE' || s === 'ERROR')) {
      throw new ShopifyRefundInDoubtException(
        externalOrderId,
        this.connectionId,
        `refund ${providerRefundId} partly failed (${statuses.join(', ')}); money may have moved in part`,
      );
    }
    if (statuses.length > 0 && statuses.every((s) => s === 'SUCCESS')) {
      const processed = refund.transactions.nodes
        .map((t) => t.processedAt)
        .filter((at): at is string => at !== null)
        .sort();
      const at = processed[processed.length - 1] ?? refund.createdAt;
      return { outcome: 'refunded', providerRefundId, refundedAt: new Date(at), providerMessage: null };
    }
    return { outcome: 'accepted', providerRefundId, refundedAt: null, providerMessage: `Transactions: ${statuses.join(', ')}` };
  }
}
