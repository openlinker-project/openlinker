/**
 * Order label — the order number and buyer name a list row shows
 *
 * Read from an order's snapshot, never assumed: a field the source did not
 * send, or one redacted at ingestion (`OL_STORE_PII=false` writes the
 * `[REDACTED]` sentinel), reads as `null`, so a surface renders "absent" rather
 * than the sentinel. Shared by the orders export (#3534) and the batch-issuing
 * screen (#3584) so the two cannot name the same order differently.
 *
 * @module libs/core/src/orders/domain
 */
import { REDACTED_PLACEHOLDER } from './order-address-redaction';

export interface OrderLabel {
  orderNumber: string | null;
  buyerName: string | null;
}

export function readSnapshotString(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value === REDACTED_PLACEHOLDER ? null : value;
}

export function readAddressName(
  snapshot: Record<string, unknown>,
  key: 'billingAddress' | 'shippingAddress'
): string | null {
  const raw = snapshot[key];
  if (typeof raw !== 'object' || raw === null) return null;
  const address = raw as Record<string, unknown>;
  const first = typeof address.firstName === 'string' ? address.firstName : '';
  const last = typeof address.lastName === 'string' ? address.lastName : '';
  const name = `${first} ${last}`.trim();
  if (name.length === 0 || name === `${REDACTED_PLACEHOLDER} ${REDACTED_PLACEHOLDER}`) return null;
  return name;
}

/** The buyer is the billing name, else the shipping name. */
export function readOrderLabel(snapshot: unknown): OrderLabel {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return { orderNumber: null, buyerName: null };
  }
  const record = snapshot as Record<string, unknown>;
  return {
    orderNumber: readSnapshotString(record, 'orderNumber'),
    buyerName:
      readAddressName(record, 'billingAddress') ?? readAddressName(record, 'shippingAddress'),
  };
}
