/**
 * Order Buyer Data Redaction
 *
 * Removes buyer personal data from a persisted order snapshot once the source's
 * retention period has passed (#4178): the shipping and billing address are
 * reduced to their country (the `OL_STORE_PII=false` shape, `redactAddress`)
 * and the buyer's email is dropped. Lines, amounts, statuses and ids stay, so
 * the order still reads, reports and reconciles.
 *
 * Works on both snapshot shapes `order_records.orderSnapshot` holds (a ready
 * order and an `awaiting_mapping` incoming snapshot): both name the fields the
 * same way. Pure; returns a new object.
 *
 * @module domain
 */
import { redactAddress, type RedactableAddress } from './order-address-redaction';

export function redactOrderSnapshotBuyerData(snapshot: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...snapshot };
  for (const key of ['shippingAddress', 'billingAddress'] as const) {
    if (key in next) {
      const address = next[key];
      next[key] = isObject(address) ? redactAddress(address as RedactableAddress) : undefined;
    }
  }
  delete next.customerEmail;
  delete next.buyerNote;
  return next;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
