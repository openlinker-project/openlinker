/**
 * Facts read out of an `OrderRecord.orderSnapshot` (#2416; extracted and
 * shared by #3426, mockup-parity epic #3401)
 *
 * ONE reader per snapshot fact, with two consumers: the pack bench
 * (`apps/api/src/bench/application/bench-order-facts.ts`) and the Assign
 * Packing Work board (`apps/api/src/fulfillment/application/
 * fulfillment-work-order-facts.ts`).
 *
 * The split between this file and those two is *where the fact comes from*
 * versus *how much of it a surface may show*. Reading `orderNumber` out of a
 * jsonb snapshot is one rule and belongs here; whether a buyer's name is
 * disclosed in full (the bench — it goes on the label a packer prints) or
 * masked (the assign board — #3425) is a per-surface decision and stays with
 * that surface. So this module deliberately exports the buyer's name
 * UNMASKED: it is the raw read, and `readMaskedBuyerName` is the transform.
 *
 * The same reasoning put `maskName` in `common/format` — see that module's
 * docblock. A second copy of a snapshot read is drift by construction, and
 * the fulfilment module's own docblock justified its earlier duplicate only
 * on the grounds that the TRANSFORM differed; for `orderReference` it does
 * not, so there is no such justification and no second copy.
 *
 * Nothing else is taken from either address — no street, no city, no
 * postcode, no phone — which is the whole reason this reads named fields
 * instead of projecting an address (ADR-062's allowlist discipline).
 *
 * Pure: no I/O, no clock, no injected dependency.
 *
 * @module apps/api/src/common/orders
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
 * `orderNumber` is what a marketplace calls the order and what an operator
 * reads back to a colleague. `undefined` when the snapshot carries none, or
 * when there is no order record at all — the caller decides whether to fall
 * back to the internal id (the bench does, so a packer's row never renders a
 * blank where its identity goes) or to report `null` (the assign board does,
 * because a board that shows `null` is telling the truth about an order it
 * cannot see).
 */
export function readOrderReference(order: OrderRecord | undefined): string | undefined {
  if (order === undefined) return undefined;
  return readString(order.orderSnapshot.orderNumber);
}

/**
 * The buyer's name from the snapshot's shipping address, then its billing one.
 *
 * UNMASKED — masking is a per-surface decision, see the module docblock.
 *
 * `null` is an ordinary answer, not a failure: under `OL_STORE_PII=false` the
 * persisted address is redacted, so there is no name to report and the surface
 * renders none. Shipping is preferred over billing because it is the name that
 * goes on the parcel.
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
