/**
 * Order -> RegisterTransactionCommand mapper (command composer)
 *
 * Pure function (no NestJS, no I/O) that composes a `RegisterTransactionCommand`
 * from a core `Order` plus caller-supplied context. The client never sends the
 * lines: an operator asks for an order to be registered, and the sale is derived
 * server-side from the order snapshot.
 *
 * Neutral throughout - no country, regime or vendor vocabulary, and NO tax
 * arithmetic: the amounts are the buyer-paid gross figures the source reported,
 * carried through unchanged (ADR-042 decision 8).
 *
 * @module libs/core/src/fiscalization/application/mappers
 */
import type { Order, OrderItem } from '@openlinker/core/orders';

import type {
  FiscalRecipient,
  FiscalTransactionLine,
  RegisterTransactionCommand,
} from '../../domain/types/fiscalization.types';
import { InvalidFiscalLineError } from './errors/invalid-fiscal-line.error';
import { UnsupportedFiscalPriceTreatmentError } from './errors/unsupported-fiscal-price-treatment.error';

/**
 * Default carrier-neutral label for the shipping line. Core has no locale, so
 * this English default is intentionally untranslated; a caller that has a locale
 * overrides it via {@link OrderToRegisterTransactionCommandInput.shippingLineName}.
 */
const SHIPPING_LINE_NAME = 'Shipping';

/** Inputs to {@link toRegisterTransactionCommand}. */
export interface OrderToRegisterTransactionCommandInput {
  order: Order;
  connectionId: string;
  /**
   * MANDATORY exactly-once key (ADR-042 decision 6). There is no keyless mode:
   * the caller must decide what "the same registration" means before core will
   * run one.
   */
  idempotencyKey: string;
  /** Optional locale-specific override for the shipping line label. */
  shippingLineName?: string;
}

/**
 * Compose a `RegisterTransactionCommand` from an `Order`.
 *
 * Throws {@link UnsupportedFiscalPriceTreatmentError} when the order is
 * net-priced, and {@link InvalidFiscalLineError} when an item's quantity is not
 * a positive finite number. Both fire BEFORE anything is persisted or sent, so a
 * malformed order produces no record and no provider call.
 *
 * Appends a gross shipping line when the buyer paid for shipping, so the
 * registered total equals the buyer-paid order total.
 */
export function toRegisterTransactionCommand(
  input: OrderToRegisterTransactionCommandInput,
): RegisterTransactionCommand {
  const { order, connectionId, idempotencyKey, shippingLineName } = input;

  // GROSS-only: a net-priced order would register net amounts labelled as gross,
  // and core may not convert (it never computes or defaults a tax rate). Fail
  // loud. An ABSENT treatment is the documented gross assumption - marketplaces
  // report buyer-paid gross - so it is accepted.
  if (order.totals.taxTreatment === 'exclusive') {
    throw new UnsupportedFiscalPriceTreatmentError(
      `Order ${order.id} is net-priced (taxTreatment "exclusive"); ` +
        `only gross-priced orders can be registered`,
    );
  }

  const lines = order.items.map((item) => toFiscalLine(item, order.id));

  const shippingLine = toShippingLine(order.totals.shipping, shippingLineName);
  if (shippingLine) {
    lines.push(shippingLine);
  }

  const command: RegisterTransactionCommand = {
    connectionId,
    orderId: order.id,
    idempotencyKey,
    currency: order.totals.currency,
    lines,
    totalGross: order.totals.total,
  };

  // The sale time is the SOURCE's placement timestamp only. `createdAt` is OL's
  // ingestion clock and must never substitute for when the sale happened.
  if (order.placedAt !== undefined) {
    command.occurredAt = order.placedAt;
  }

  const recipient = toRecipient(order);
  if (recipient) {
    command.recipient = recipient;
  }

  return command;
}

/**
 * Map an {@link OrderItem} onto a {@link FiscalTransactionLine}. `name` falls
 * back to `sku` then `productId` when the source omitted a label. `taxRate` is
 * left EMPTY - the adapter's regime mapping resolves it; core never names a rate.
 */
function toFiscalLine(item: OrderItem, orderId: string): FiscalTransactionLine {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} has an item with a non-positive quantity; ` +
        `cannot compose a registrable line`,
    );
  }
  return {
    name: item.name?.trim() || item.sku || item.productId,
    quantity: item.quantity,
    unitPriceGross: item.price,
    taxRate: '',
    sku: item.sku ?? null,
  };
}

/**
 * Compose the shipping line from the order's gross shipping cost, or `null` when
 * the buyer paid nothing for shipping (no phantom line). Non-positive or
 * non-finite shipping yields no line.
 */
function toShippingLine(
  shipping: number,
  name?: string,
): FiscalTransactionLine | null {
  if (!Number.isFinite(shipping) || shipping <= 0) {
    return null;
  }
  return {
    name: name?.trim() || SHIPPING_LINE_NAME,
    quantity: 1,
    unitPriceGross: shipping,
    taxRate: '',
    sku: null,
  };
}

/**
 * Derive the optional delivery target from the order snapshot. Returns `null`
 * when the snapshot carries neither channel - which is normal under a
 * hash-only PII configuration, and is not an error: an adapter whose provider
 * returns the artefact inline needs no target at all.
 */
function toRecipient(order: Order): FiscalRecipient | null {
  const email = order.customerEmail?.trim() || null;
  const phone = order.shippingAddress?.phone?.trim() || null;
  if (email === null && phone === null) {
    return null;
  }
  return { email, phone };
}
