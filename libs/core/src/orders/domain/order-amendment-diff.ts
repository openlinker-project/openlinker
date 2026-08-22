/**
 * Order Amendment Diff
 *
 * Pure comparison of an order's ALREADY-STORED snapshot against the order the
 * source just reported, producing the list of changes that a re-ingestion is
 * about to silently absorb (#2283).
 *
 * The problem it exists for: ingestion overwrites `orderSnapshot` wholesale, so
 * a line that shrank, vanished or changed quantity — or a shipping address the
 * buyer edited — left no trace at all. No fact, no operator surface, and any
 * shipment already referencing the removed line dangles with nothing explaining
 * why. This module names what changed; persisting and surfacing it is the
 * caller's job.
 *
 * ## What is compared, and why only this
 *
 * Lines are keyed by `items[].id` and compared on `quantity` alone. The key is
 * safe across BOTH snapshot shapes: the raw path stores `incoming.items`
 * verbatim, and the ready path sets `id: item.id` — the source's own line id in
 * both cases (only `productId` / `variantId` are internalised). Price, name and
 * image are deliberately ignored: price churn is ordinary and would drown the
 * signal, and neither dangles a shipment.
 *
 * The shipping address is compared field-by-field, and only FIELD NAMES ever
 * leave this module. A change list is persisted and rendered to operators, so
 * carrying before/after address values would put buyer PII into a second store
 * with none of the `OL_STORE_PII` discipline the snapshot itself has.
 *
 * ## Hash-only mode
 *
 * Under `OL_STORE_PII=false` the stored address is already redacted, so the
 * incoming one is passed through the SAME rule ({@link redactAddress}) before
 * comparison. Without that, every poll would compare a raw address against a
 * redacted one and report a change on every order forever. The documented cost:
 * in hash-only mode only a `country` change is detectable at all. That is a real
 * blind spot, stated rather than hidden — the alternative is a false-positive
 * storm or storing the PII this deployment explicitly opted out of.
 *
 * Domain-only: pure, no framework dependencies, no I/O. Every read of the prior
 * snapshot is defensive (it is an untyped `Record<string, unknown>` that may
 * predate any of these keys); a malformed or absent prior yields no changes
 * rather than throwing, mirroring `OrderIngestionService.readSnapshotStatus`.
 *
 * @module libs/core/src/orders/domain
 */
import type { IncomingOrder } from './types/incoming-order.types';
import { redactAddress, type RedactableAddress } from './order-address-redaction';

/** The kinds of source-side amendment this diff can observe. */
export const OrderAmendmentChangeKindValues = [
  'line-removed',
  'line-added',
  'line-quantity-changed',
  'shipping-address-changed',
] as const;

export type OrderAmendmentChangeKind = (typeof OrderAmendmentChangeKindValues)[number];

/**
 * One observed change. PII-free by construction: ids, SKUs and quantities are
 * carried verbatim (none is personal data), while an address contributes only
 * the NAMES of the fields that moved.
 */
export interface OrderAmendmentChange {
  kind: OrderAmendmentChangeKind;
  /** Source-native line id, for the line-grained kinds. */
  lineId?: string;
  /** Source-native SKU when the source reported one, for operator legibility. */
  sku?: string;
  fromQuantity?: number;
  toQuantity?: number;
  /**
   * Address-grain only: the names of the fields that differ. NEVER values —
   * see the module header.
   */
  fields?: string[];
}

export interface OrderAmendmentDiffOptions {
  /** The deployment's `OL_STORE_PII` setting, as the snapshot writers saw it. */
  storePii: boolean;
}

/**
 * The address fields worth reporting on. Fixed rather than derived from the
 * objects, so a source that starts emitting an extra key cannot silently widen
 * what OpenLinker reports — and so the two snapshot shapes (`Address` on the
 * ready path, `IncomingOrderAddress` on the raw path) compare on their common
 * ground.
 */
const COMPARED_ADDRESS_FIELDS = [
  'firstName',
  'lastName',
  'company',
  'address1',
  'address2',
  'city',
  'state',
  'postalCode',
  'country',
  'phone',
] as const;

interface PriorLine {
  quantity: number;
  sku?: string;
}

/**
 * Compare a stored snapshot against the incoming order.
 *
 * Returns `[]` — never throws — for a first ingestion (`null` prior), a prior
 * that carries no usable `items` array, and an unchanged re-poll. An empty
 * result means "no fact to record", which is the overwhelmingly common case on
 * a steady-state poll.
 */
export function diffOrderAmendment(
  priorSnapshot: Record<string, unknown> | null | undefined,
  incoming: IncomingOrder,
  options: OrderAmendmentDiffOptions
): OrderAmendmentChange[] {
  if (!priorSnapshot) {
    return [];
  }

  const changes: OrderAmendmentChange[] = [];
  changes.push(...diffLines(priorSnapshot, incoming));

  const addressFields = diffShippingAddress(priorSnapshot, incoming, options.storePii);
  if (addressFields.length > 0) {
    changes.push({ kind: 'shipping-address-changed', fields: addressFields });
  }

  return changes;
}

function diffLines(
  priorSnapshot: Record<string, unknown>,
  incoming: IncomingOrder
): OrderAmendmentChange[] {
  const prior = readPriorLines(priorSnapshot);
  // An absent/garbled prior `items` is indistinguishable from "we never stored
  // lines", so reporting every incoming line as ADDED would manufacture an
  // amendment out of a storage gap. Report nothing.
  if (prior === null) {
    return [];
  }

  const changes: OrderAmendmentChange[] = [];
  const seen = new Set<string>();

  for (const item of incoming.items ?? []) {
    const lineId = item?.id;
    if (typeof lineId !== 'string' || lineId.length === 0) {
      continue;
    }
    seen.add(lineId);

    const before = prior.get(lineId);
    const toQuantity = item.quantity;
    if (!before) {
      changes.push({
        kind: 'line-added',
        lineId,
        ...(item.sku !== undefined && { sku: item.sku }),
        toQuantity,
      });
      continue;
    }
    if (before.quantity !== toQuantity) {
      changes.push({
        kind: 'line-quantity-changed',
        lineId,
        ...(item.sku !== undefined && { sku: item.sku }),
        fromQuantity: before.quantity,
        toQuantity,
      });
    }
  }

  for (const [lineId, before] of prior) {
    if (!seen.has(lineId)) {
      changes.push({
        kind: 'line-removed',
        lineId,
        ...(before.sku !== undefined && { sku: before.sku }),
        fromQuantity: before.quantity,
      });
    }
  }

  return changes;
}

/**
 * Read the prior snapshot's lines into a quantity-by-id map, or `null` when the
 * snapshot carries nothing usable. A line whose `id` or `quantity` is malformed
 * is dropped individually rather than failing the whole read.
 */
function readPriorLines(priorSnapshot: Record<string, unknown>): Map<string, PriorLine> | null {
  const raw = priorSnapshot.items;
  if (!Array.isArray(raw)) {
    return null;
  }

  const lines = new Map<string, PriorLine>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { id, quantity, sku } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0 || typeof quantity !== 'number') {
      continue;
    }
    lines.set(id, {
      quantity,
      ...(typeof sku === 'string' && { sku }),
    });
  }
  return lines;
}

function diffShippingAddress(
  priorSnapshot: Record<string, unknown>,
  incoming: IncomingOrder,
  storePii: boolean
): string[] {
  const priorRaw = priorSnapshot.shippingAddress;
  const priorAddress =
    typeof priorRaw === 'object' && priorRaw !== null
      ? (priorRaw as Record<string, unknown>)
      : undefined;

  // Project the incoming address through the SAME rule the snapshot writers
  // applied, so like is compared with like. See the module header.
  const incomingProjected = storePii
    ? (incoming.shippingAddress as Record<string, unknown> | undefined)
    : (redactAddress(incoming.shippingAddress as RedactableAddress | undefined) as
        | Record<string, unknown>
        | undefined);

  // Absence on either side is not a field-level change: an order that never had
  // an address, or a source that stopped reporting one, is not a buyer edit and
  // naming every field would be noise. Only a present-vs-present pair is diffed.
  if (!priorAddress || !incomingProjected) {
    return [];
  }

  const fields: string[] = [];
  for (const field of COMPARED_ADDRESS_FIELDS) {
    const before = normaliseAddressField(priorAddress[field]);
    const after = normaliseAddressField(incomingProjected[field]);
    if (before !== after) {
      fields.push(field);
    }
  }
  return fields;
}

/**
 * Treat an absent, null and empty-string field as one value. Adapters and JSON
 * round-trips disagree on which of the three an unset field becomes, and a
 * change between two spellings of "nothing" is not an amendment.
 */
function normaliseAddressField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
