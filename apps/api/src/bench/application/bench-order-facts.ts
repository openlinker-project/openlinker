/**
 * Order facts the bench is allowed to read (#2416, extracted by #2418)
 *
 * Two projections off an `OrderRecord`, and NOTHING else from the snapshot.
 *
 * These were module-private helpers in `BenchWorkService` until the parcel read
 * needed the same two answers. Restating them would have given one surface two
 * spellings of a packer's own order reference — and, worse, two chances for a
 * second field to be taken from the snapshot without anybody noticing. There is
 * one place a bench reads an order, and this is it.
 *
 * Pure: no I/O, no clock, no injected dependency.
 *
 * @module apps/api/src/bench/application
 */
import type { OrderRecord } from '@openlinker/core/orders';

/** A non-empty trimmed string, or `undefined`. */
function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The source's own order reference, when the snapshot carries one.
 *
 * `orderNumber` is what a marketplace calls the order and what a packer reads
 * back to a colleague. Absent, the caller falls back to the internal id, which
 * is always there — so a row never renders a blank where its identity goes.
 */
export function readOrderReference(order: OrderRecord | undefined): string | undefined {
  if (order === undefined) return undefined;
  const snapshot = order.orderSnapshot;
  return readString(snapshot.orderNumber);
}

/**
 * The buyer's name from the snapshot's shipping address, then its billing one.
 *
 * `null` is an ordinary answer, not a failure: under `OL_STORE_PII=false` the
 * persisted address is redacted, so there is no name to report and the surface
 * renders none. Shipping is preferred over billing because it is the name that
 * goes on the parcel.
 *
 * Nothing else is taken from either address — no street, no city, no postcode,
 * no phone — which is the whole reason this reads two named fields instead of
 * projecting an address.
 */
export function readBuyerName(order: OrderRecord | undefined): string | null {
  if (order === undefined) return null;
  const snapshot = order.orderSnapshot;

  for (const key of ['shippingAddress', 'billingAddress']) {
    const address = snapshot[key];
    if (typeof address !== 'object' || address === null) continue;
    const record = address as Record<string, unknown>;
    const name = [readString(record.firstName), readString(record.lastName)]
      .filter((part): part is string => part !== undefined)
      .join(' ');
    if (name.length > 0) return name;
    const company = readString(record.company);
    if (company !== undefined) return company;
  }
  return null;
}
