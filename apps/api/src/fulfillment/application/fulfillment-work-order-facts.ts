/**
 * Order facts the operator worklist is allowed to read (#3425, mockup-parity
 * epic #3401)
 *
 * The Assign Packing Work board's own read, DISTINCT from
 * `apps/api/src/bench/application/bench-order-facts.ts` — that file's own
 * docblock reserves it as "the one place a bench reads an order", and reading
 * the buyer's name here needs a different transform (masking) than the
 * bench's own disclosure (the full name, because that name is what goes on
 * the label a packer prints — #2416's already-decided PII call). Two
 * contexts, two questions, two functions.
 *
 * `libs/core/src/fulfillment` is a registered zero-sibling-edge leaf whose
 * no-injection invariant (ADR-053) forbids it reading `orders` — so, exactly
 * as the bench does it, the join happens here in `apps/api`, over the
 * published `IOrderRecordService` interface and never a `*RepositoryPort`.
 *
 * Pure: no I/O, no clock, no injected dependency.
 *
 * @module apps/api/src/fulfillment/application
 */
import type { OrderRecord } from '@openlinker/core/orders';

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The buyer's full name from the snapshot, before masking — an internal
 * helper, never exported, so nothing outside {@link readMaskedBuyerName} can
 * reach the unmasked value from this module.
 */
function readFullBuyerName(order: OrderRecord | undefined): string | null {
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

/**
 * Mask a full name to its FIRST INITIAL plus surname — "Anna Kowalska"
 * becomes "A. Kowalska" — so an operator can recognise the order without
 * this board carrying the buyer's full identity (#3425, reversing ADR-062's
 * exclusion by explicit product decision, with masking as the condition of
 * that reversal).
 *
 * A single-word name (a company, or a name the source reported as one
 * field) is returned UNMASKED — there is no surname to keep and no first
 * name to reduce to an initial, so masking it further would destroy the
 * only identifying fact rather than merely reduce it.
 */
function maskName(name: string): string {
  const parts = name.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length < 2) return name;
  const [first, ...rest] = parts;
  return `${first.charAt(0)}. ${rest.join(' ')}`;
}

/**
 * The buyer's name, MASKED (#3425) — the one buyer-identity field this
 * board may carry, and never the full name `readFullBuyerName` resolves
 * internally. `null` is an ordinary answer (no name in the snapshot, or
 * `OL_STORE_PII=false`), never a placeholder.
 */
export function readMaskedBuyerName(order: OrderRecord | undefined): string | null {
  const full = readFullBuyerName(order);
  return full === null ? null : maskName(full);
}

/** The source's own delivery-method label (#1792), or `null`. */
export function readCarrierName(order: OrderRecord | undefined): string | null {
  return order?.sourceDeliveryMethodName ?? null;
}
