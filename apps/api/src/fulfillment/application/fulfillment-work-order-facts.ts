/**
 * Order facts the operator worklist is allowed to read (#3425 / #3426,
 * mockup-parity epic #3401)
 *
 * The Assign Packing Work board's own read, DISTINCT from
 * `apps/api/src/bench/application/bench-order-facts.ts` — that file's own
 * docblock reserves it as "the one place a bench reads an order", and reading
 * the buyer's name here needs a different transform (masking) than the
 * bench's own disclosure (the full name, because that name is what goes on
 * the label a packer prints — #2416's already-decided PII call). Two
 * contexts, two questions, two TRANSFORMS.
 *
 * The transforms are what differ; the snapshot READS do not, so since #3426
 * both surfaces take those from `apps/api/src/common/orders/
 * order-snapshot-facts` and this module is the assign board's transform layer
 * over them. The earlier duplicate here was justified on the grounds that the
 * transform differed — true of the buyer's name, and NOT true of the order
 * reference, which is byte-identical on both surfaces.
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

import { maskName } from '../../common/format/mask-name';
import { readBuyerName, readOrderReference } from '../../common/orders/order-snapshot-facts';

/**
 * The source's own order reference — "OL-4471", the string the mockup's lane
 * card leads with and the one an operator says out loud.
 *
 * `null`, and deliberately NOT a fallback to the internal id, when the order
 * is absent from `order_records` or its snapshot names no reference. A
 * `FulfillmentWork` holds `orderId` by value with no foreign key, so it can
 * outlive or precede its order record; a board that answers `null` there says
 * "OpenLinker cannot see this order", which is a fact the supervisor can act
 * on, while `ol_order_0aaeb3c4…` dressed up as a reference is the unreadable
 * id this whole change exists to remove. The internal id is on the same row
 * as `orderId` regardless, so nothing is lost by declining to repeat it here.
 *
 * (The bench falls back, and is right to: a packer holding the parcel needs
 * SOME identity in that slot. A supervisor triaging a board needs to know
 * which rows are unattributed.)
 */
export function readOrderReferenceOrNull(order: OrderRecord | undefined): string | null {
  return readOrderReference(order) ?? null;
}

/**
 * The buyer's name, MASKED (#3425) — the one buyer-identity field this
 * board may carry, and never the full name the shared reader resolves.
 * `null` is an ordinary answer (no name in the snapshot, or
 * `OL_STORE_PII=false`), never a placeholder.
 *
 * The masking rule itself is shared (`common/format/mask-name`): reversing
 * ADR-062's exclusion by explicit product decision was conditional on
 * masking, and the bench's collision banner (#3415) reduces a packer's name
 * by the SAME rule, so the two cannot disclose different amounts.
 */
export function readMaskedBuyerName(order: OrderRecord | undefined): string | null {
  const full = readBuyerName(order);
  return full === null ? null : maskName(full);
}

/** The source's own delivery-method label (#1792), or `null`. */
export function readCarrierName(order: OrderRecord | undefined): string | null {
  return order?.sourceDeliveryMethodName ?? null;
}
