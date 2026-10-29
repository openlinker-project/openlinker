/**
 * Order Edits Overlay (#3542, D9, ADR-044 / ADR-017)
 *
 * What an operator changed on an order AFTER import, kept beside the channel's
 * own snapshot instead of inside it. Ingestion rewrites `orderSnapshot` wholesale
 * on every poll and webhook, so an edit written into the snapshot would be
 * erased by the next re-ingestion; the overlay lives in its own column
 * (`order_records.orderEdits`, sole writer `applyOrderEdit`) that no ingestion
 * statement names, and is MERGED over the channel snapshot when a record is read.
 *
 * The persisted `orderSnapshot` column is therefore ALWAYS the channel original.
 * `OrderRecord.orderSnapshot` is the effective (merged) view, and
 * `OrderRecord.channelSnapshot` is the original, for the few readers that want
 * what the channel reported (source-amendment diff, FX, analytics).
 *
 * ## What the merge does
 *
 * - `address` replaces the SHIPPING address only (billing and the invoice buyer
 *   are not part of this edit).
 * - `lines` holds ABSOLUTE new quantities. They can only go down: the effective
 *   quantity is `min(overlay, channel)`, so a source that later lowers the same
 *   line wins and a source that raises it is ignored. A line at 0 is dropped from
 *   `items` (documents may not carry a non-positive quantity).
 * - `deliveryMethod` replaces `shipping` and `pickupPoint`.
 * - Totals are restated so the lines still sum to the total (the invoice and
 *   fiscal mappers refuse an order whose lines contradict their own total):
 *   `total` and `subtotal` fall by the removed units at their line prices, and a
 *   cash-on-delivery amount falls by the same difference. `tax` is NOT restated:
 *   core computes no tax (ADR-063), so the figure stays the channel's and the
 *   view says so (`taxRestated: false`).
 * - `discount` is the order-level discount money event (#3543, ADR-014
 *   amendment). The CURRENT absolute amount is distributed across the lines that
 *   remain after the quantity edits (`order-discount.types.ts` owns the split and
 *   its rounding), each line's gross unit price falls accordingly so the lines
 *   still sum to the restated total, `total`, `subtotal` and `discountTotal` are
 *   restated and a cash-on-delivery amount falls by the same figure.
 *
 * Pure functions, no I/O, per the pure-rule exception in
 * `docs/engineering-standards.md`: the guard and the merge ARE the rules for this
 * type and are edited with it.
 *
 * @module libs/core/src/orders/domain/types
 */
import { minorUnitExponentFor } from '@openlinker/core/sales-documents';

import {
  applyDiscountToLines,
  readOrderDiscountEdit,
  effectiveDiscountAmount,
  restateTotalsForDiscount,
  type OrderDiscountEdit,
} from './order-discount.types';
import type {
  Address,
  Order,
  OrderItem,
  OrderPickupPoint,
  OrderShipping,
  PriceTaxTreatment,
} from './order.types';

export interface OrderEditStamp {
  readonly changeId: string;
  /** ISO instant of the edit. */
  readonly editedAt: string;
  readonly editedBy: string | null;
}

export interface OrderAddressEdit extends OrderEditStamp {
  readonly shipping: Address;
  /** Hash of the NEW address, stamped by the writer (the ingestion one is stale after an edit). */
  readonly hash: string | null;
}

export interface OrderLineEdit extends OrderEditStamp {
  /** Absolute new quantity; always lower than the channel's. */
  readonly quantity: number;
}

export interface OrderDeliveryMethodEdit extends OrderEditStamp {
  readonly methodId: string;
  readonly methodName: string | null;
  readonly pickupPoint: OrderPickupPoint | null;
}

export interface OrderEdits {
  readonly v: 1;
  /** Bumped by every write; the writer's optimistic-concurrency token. */
  readonly rev: number;
  readonly address?: OrderAddressEdit;
  /** Keyed by `OrderItem.id`. */
  readonly lines?: Readonly<Record<string, OrderLineEdit>>;
  readonly deliveryMethod?: OrderDeliveryMethodEdit;
  /** The current order-level discount (#3543). A zero amount means "removed". */
  readonly discount?: OrderDiscountEdit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStamp(value: Record<string, unknown>): OrderEditStamp | null {
  if (typeof value.changeId !== 'string' || typeof value.editedAt !== 'string') {
    return null;
  }
  return {
    changeId: value.changeId,
    editedAt: value.editedAt,
    editedBy: typeof value.editedBy === 'string' ? value.editedBy : null,
  };
}

function readAddress(value: unknown): Address | null {
  if (!isRecord(value) || typeof value.address1 !== 'string' || typeof value.city !== 'string') {
    return null;
  }
  return value as unknown as Address;
}

/**
 * Coerce a persisted `orderEdits` value. Never throws and never guesses: a value
 * this build does not recognise reads as `null` (no edits), and each section is
 * kept only when it is well formed, so one corrupt section cannot hide the rest.
 */
export function readOrderEdits(value: unknown): OrderEdits | null {
  if (!isRecord(value) || value.v !== 1) {
    return null;
  }
  const rev = typeof value.rev === 'number' && Number.isInteger(value.rev) ? value.rev : 0;
  let address: OrderAddressEdit | undefined;
  if (isRecord(value.address)) {
    const stamp = readStamp(value.address);
    const shipping = readAddress(value.address.shipping);
    if (stamp !== null && shipping !== null) {
      address = {
        ...stamp,
        shipping,
        hash: typeof value.address.hash === 'string' ? value.address.hash : null,
      };
    }
  }
  let lines: Record<string, OrderLineEdit> | undefined;
  if (isRecord(value.lines)) {
    for (const [lineId, raw] of Object.entries(value.lines)) {
      if (!isRecord(raw)) continue;
      const stamp = readStamp(raw);
      if (
        stamp === null ||
        typeof raw.quantity !== 'number' ||
        !Number.isInteger(raw.quantity) ||
        raw.quantity < 0
      ) {
        continue;
      }
      lines = { ...(lines ?? {}), [lineId]: { ...stamp, quantity: raw.quantity } };
    }
  }
  let deliveryMethod: OrderDeliveryMethodEdit | undefined;
  if (isRecord(value.deliveryMethod)) {
    const stamp = readStamp(value.deliveryMethod);
    if (stamp !== null && typeof value.deliveryMethod.methodId === 'string') {
      const pickup = value.deliveryMethod.pickupPoint;
      deliveryMethod = {
        ...stamp,
        methodId: value.deliveryMethod.methodId,
        methodName:
          typeof value.deliveryMethod.methodName === 'string'
            ? value.deliveryMethod.methodName
            : null,
        pickupPoint: isRecord(pickup) && typeof pickup.id === 'string' ? (pickup as unknown as OrderPickupPoint) : null,
      };
    }
  }
  const discount = readOrderDiscountEdit(value.discount);
  if (address === undefined && lines === undefined && deliveryMethod === undefined && discount === undefined) {
    return null;
  }
  return {
    v: 1,
    rev,
    ...(address !== undefined && { address }),
    ...(lines !== undefined && { lines }),
    ...(deliveryMethod !== undefined && { deliveryMethod }),
    ...(discount !== undefined && { discount }),
  };
}

/** The slice of a line the quantity merge needs; both `OrderItem` and a snapshot item satisfy it. */
interface EditableLine {
  readonly id: string;
  readonly quantity: number;
  readonly price: number;
  readonly unitPriceGross?: number;
}

/** How the order's own figures express tax, read off `totals`. */
export interface LineEditTreatments {
  /** `totals.taxTreatment`: what a line `price` is. Absent means gross. */
  readonly lines?: PriceTaxTreatment;
  /** `totals.totalTaxTreatment ?? totals.taxTreatment`: what `total` is. Absent means gross. */
  readonly total?: PriceTaxTreatment;
}

/**
 * The per-unit amount a removed unit takes off `total`, in the basis `total`
 * is expressed in. `null` when it cannot be known: a net-priced line with no
 * reported gross unit price, on a gross total. Subtracting the NET price from
 * a GROSS total would restate the order wrongly (B-38), so the caller refuses
 * the edit rather than guess, and the pure merge leaves such a line out of the
 * restated total.
 */
export function resolveTotalUnitPrice(
  item: EditableLine,
  treatments: LineEditTreatments | undefined
): number | null {
  if (treatments?.total === 'exclusive') return item.price;
  if (typeof item.unitPriceGross === 'number' && Number.isFinite(item.unitPriceGross)) {
    return item.unitPriceGross;
  }
  return treatments?.lines === 'exclusive' ? null : item.price;
}

/** Read the two treatments off a `totals` record, tolerating anything malformed. */
export function readLineEditTreatments(totals: unknown): LineEditTreatments {
  if (!isRecord(totals)) return {};
  const lines =
    totals.taxTreatment === 'inclusive' || totals.taxTreatment === 'exclusive'
      ? totals.taxTreatment
      : undefined;
  const totalOnly =
    totals.totalTaxTreatment === 'inclusive' || totals.totalTaxTreatment === 'exclusive'
      ? totals.totalTaxTreatment
      : lines;
  return {
    ...(lines !== undefined && { lines }),
    ...(totalOnly !== undefined && { total: totalOnly }),
  };
}

/**
 * Overlay entries whose line id matches no line of the channel snapshot: the
 * channel renamed or dropped the line after the edit. They are KEPT (never
 * silently dropped) and reported, so an operator sees an edit that no longer
 * applies instead of an order that quietly reverted.
 */
export interface UnmatchedLineEdit {
  readonly orderLineId: string;
  readonly editedQuantity: number;
  readonly editedAt: string;
}

export function findUnmatchedLineEdits(
  channelSnapshot: Record<string, unknown>,
  edits: OrderEdits | null
): UnmatchedLineEdit[] {
  if (edits?.lines === undefined) return [];
  const ids = new Set<string>();
  if (Array.isArray(channelSnapshot.items)) {
    for (const raw of channelSnapshot.items) {
      if (isRecord(raw) && typeof raw.id === 'string') ids.add(raw.id);
    }
  }
  return Object.entries(edits.lines)
    .filter(([lineId]) => !ids.has(lineId))
    .map(([orderLineId, edit]) => ({
      orderLineId,
      editedQuantity: edit.quantity,
      editedAt: edit.editedAt,
    }));
}

export interface LineEditOutcome<T extends EditableLine> {
  readonly items: T[];
  /** Σ removed units × gross unit price (what the buyer no longer owes). */
  readonly totalDelta: number;
  /** Σ removed units × line price (the subtotal's own basis). */
  readonly subtotalDelta: number;
  /** Lowered lines whose gross price is unknown; they are NOT in `totalDelta`. */
  readonly unresolvedLineIds: string[];
}

/**
 * The effective quantity of one line: `min(overlay, channel)`. Pure and shared so
 * the preview, the view and the merge cannot disagree.
 */
export function effectiveLineQuantity(channelQuantity: number, edit: OrderLineEdit | undefined): number {
  if (edit === undefined) return channelQuantity;
  return Math.min(edit.quantity, channelQuantity);
}

export function applyLineEdits<T extends EditableLine>(
  items: readonly T[],
  lines: Readonly<Record<string, OrderLineEdit>> | undefined,
  treatments?: LineEditTreatments
): LineEditOutcome<T> {
  let totalDelta = 0;
  let subtotalDelta = 0;
  const unresolvedLineIds: string[] = [];
  const out: T[] = [];
  for (const item of items) {
    const quantity = effectiveLineQuantity(item.quantity, lines?.[item.id]);
    const removed = item.quantity - quantity;
    if (removed > 0) {
      const unit = resolveTotalUnitPrice(item, treatments);
      if (unit === null) {
        unresolvedLineIds.push(item.id);
      } else {
        totalDelta += removed * unit;
      }
      subtotalDelta += removed * item.price;
    }
    if (quantity > 0) {
      out.push(quantity === item.quantity ? item : { ...item, quantity });
    }
  }
  return { items: out, totalDelta, subtotalDelta, unresolvedLineIds };
}

function roundTo(value: number, currency: string): number {
  const exponent = minorUnitExponentFor(currency.trim() === '' ? 'PLN' : currency.trim());
  return Number(value.toFixed(exponent));
}

/** The restated totals after a line edit, never below zero. */
export function restateTotals<T extends { total: number; subtotal: number; currency: string }>(
  totals: T,
  deltas: { totalDelta: number; subtotalDelta: number }
): T {
  if (deltas.totalDelta === 0 && deltas.subtotalDelta === 0) return totals;
  return {
    ...totals,
    total: Math.max(0, roundTo(totals.total - deltas.totalDelta, totals.currency)),
    subtotal: Math.max(0, roundTo(totals.subtotal - deltas.subtotalDelta, totals.currency)),
  };
}

/** A cash-on-delivery amount restated by the same difference; `undefined` once nothing is left to collect. */
export function restateCodToCollect(
  cod: { amount: string; currency: string },
  totalDelta: number
): { amount: string; currency: string } | undefined {
  if (totalDelta === 0) return cod;
  const current = Number(cod.amount);
  if (!Number.isFinite(current)) return cod;
  const next = roundTo(current - totalDelta, cod.currency);
  if (next <= 0) return undefined;
  return { amount: next.toFixed(minorUnitExponentFor(cod.currency.trim() || 'PLN')), currency: cod.currency };
}

function readSnapshotItems(value: unknown): Array<Record<string, unknown> & EditableLine> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((raw) => ({
    ...raw,
    id: typeof raw.id === 'string' ? raw.id : '',
    quantity: typeof raw.quantity === 'number' ? raw.quantity : 0,
    price: typeof raw.price === 'number' ? raw.price : 0,
    ...(typeof raw.unitPriceGross === 'number' && Number.isFinite(raw.unitPriceGross)
      ? { unitPriceGross: raw.unitPriceGross }
      : {}),
  }));
}

/**
 * Merge the overlay over a channel snapshot. Returns the SAME object when there
 * is nothing to merge, so the common case (no edits) allocates nothing and is
 * byte-identical to the pre-#3542 read.
 */
export function applyOrderEditsToSnapshot(
  channelSnapshot: Record<string, unknown>,
  edits: OrderEdits | null
): Record<string, unknown> {
  if (edits === null) return channelSnapshot;
  const merged: Record<string, unknown> = { ...channelSnapshot };

  if (edits.address !== undefined) {
    merged.shippingAddress = edits.address.shipping;
  }
  if (edits.deliveryMethod !== undefined) {
    const shipping: OrderShipping = { methodId: edits.deliveryMethod.methodId };
    if (edits.deliveryMethod.methodName !== null) shipping.methodName = edits.deliveryMethod.methodName;
    merged.shipping = shipping;
    if (edits.deliveryMethod.pickupPoint !== null) {
      merged.pickupPoint = edits.deliveryMethod.pickupPoint;
    } else {
      delete merged.pickupPoint;
    }
  }
  if (
    Array.isArray(channelSnapshot.items) &&
    (edits.lines !== undefined || effectiveDiscountAmount(edits.discount) > 0)
  ) {
    const outcome = applyLineEdits(
      readSnapshotItems(channelSnapshot.items),
      edits.lines,
      readLineEditTreatments(channelSnapshot.totals)
    );
    const totals = channelSnapshot.totals;
    const currency = isRecord(totals) && typeof totals.currency === 'string' ? totals.currency : '';
    const inclusive = !isRecord(totals) || totals.taxTreatment !== 'exclusive';
    const discounted = applyDiscountToLines(outcome.items, edits.discount, currency, inclusive);
    merged.items = discounted.items;
    if (isRecord(totals) && typeof totals.total === 'number' && typeof totals.subtotal === 'number') {
      const base = restateTotals(
        { ...totals, total: totals.total, subtotal: totals.subtotal, currency },
        outcome
      );
      merged.totals = restateTotalsForDiscount(
        {
          ...base,
          ...(typeof totals.discountTotal === 'number' && { discountTotal: totals.discountTotal }),
        },
        discounted.amount,
        inclusive
      );
    }
    const cod = channelSnapshot.codToCollect;
    if (isRecord(cod) && typeof cod.amount === 'string' && typeof cod.currency === 'string') {
      const restated = restateCodToCollect(
        { amount: cod.amount, currency: cod.currency },
        outcome.totalDelta + discounted.amount
      );
      if (restated === undefined) {
        delete merged.codToCollect;
      } else {
        merged.codToCollect = restated;
      }
    }
  }
  return merged;
}

/**
 * The same merge over a live in-memory {@link Order}, for the ingestion path:
 * everything after `persistOrder` (reservations, routing, the destination
 * mirror, auto-issue) works from the live Order, not the snapshot, and must see
 * the edited order or a re-poll would re-reserve and re-route the original.
 */
export function applyOrderEditsToOrder(order: Order, edits: OrderEdits | null): Order {
  if (edits === null) return order;
  const merged: Order = { ...order };
  if (edits.address !== undefined) {
    merged.shippingAddress = edits.address.shipping;
  }
  if (edits.deliveryMethod !== undefined) {
    const shipping: OrderShipping = { methodId: edits.deliveryMethod.methodId };
    if (edits.deliveryMethod.methodName !== null) shipping.methodName = edits.deliveryMethod.methodName;
    merged.shipping = shipping;
    if (edits.deliveryMethod.pickupPoint !== null) {
      merged.pickupPoint = edits.deliveryMethod.pickupPoint;
    } else {
      delete merged.pickupPoint;
    }
  }
  if (edits.lines !== undefined || effectiveDiscountAmount(edits.discount) > 0) {
    const outcome = applyLineEdits<OrderItem>(
      order.items,
      edits.lines,
      readLineEditTreatments(order.totals)
    );
    const inclusive = order.totals.taxTreatment !== 'exclusive';
    const discounted = applyDiscountToLines(
      outcome.items,
      edits.discount,
      order.totals.currency,
      inclusive
    );
    merged.items = discounted.items;
    merged.totals = restateTotalsForDiscount(
      restateTotals(order.totals, outcome),
      discounted.amount,
      inclusive
    );
    if (order.codToCollect !== undefined) {
      const restated = restateCodToCollect(
        order.codToCollect,
        outcome.totalDelta + discounted.amount
      );
      if (restated === undefined) {
        delete merged.codToCollect;
      } else {
        merged.codToCollect = restated;
      }
    }
  }
  return merged;
}

/** Both figures an operator surface shows: what the channel charged, and the order after the edit. */
export interface OrderEditedTotals {
  readonly currency: string;
  readonly channelTotal: number;
  readonly total: number;
  /**
   * `channelTotal - total`: the quantity edits and the discount together. Informational on
   * its own - a refund intent exists only for a discount on a paid order (#3543).
   */
  readonly difference: number;
  /** The discount the channel itself applied to the whole order; null = the channel reported none (E-44). */
  readonly channelDiscountTotal: number | null;
  /**
   * Channel discount + the OpenLinker discount, the single figure an operator sees (E-44).
   * Null only when neither exists; computed here and nowhere else.
   */
  readonly combinedDiscountTotal: number | null;
  /** Always `false`: core computes no tax (ADR-063), so `tax` stays the channel's. */
  readonly taxRestated: false;
}

export function describeEditedTotals(
  channelSnapshot: Record<string, unknown>,
  edits: OrderEdits | null
): OrderEditedTotals | null {
  const totals = channelSnapshot.totals;
  if (!isRecord(totals) || typeof totals.total !== 'number') return null;
  const effective = applyOrderEditsToSnapshot(channelSnapshot, edits).totals;
  const effectiveTotal =
    isRecord(effective) && typeof effective.total === 'number' ? effective.total : totals.total;
  const currency = typeof totals.currency === 'string' ? totals.currency : '';
  const channelDiscountTotal =
    typeof totals.discountTotal === 'number' && totals.discountTotal > 0 ? totals.discountTotal : null;
  const olDiscount = effectiveDiscountAmount(edits?.discount);
  return {
    currency,
    channelTotal: totals.total,
    total: effectiveTotal,
    difference: roundTo(totals.total - effectiveTotal, currency),
    channelDiscountTotal,
    combinedDiscountTotal:
      channelDiscountTotal === null && olDiscount <= 0
        ? null
        : roundTo((channelDiscountTotal ?? 0) + olDiscount, currency),
    taxRestated: false,
  };
}

/**
 * Input of the overlay's sole writer. Each present section is merged into the
 * overlay (`lines` per line); absent sections are left as committed.
 */
export interface ApplyOrderEditInput {
  readonly internalOrderId: string;
  /** The overlay's `rev` the caller read; a mismatch writes nothing. */
  readonly expectedRev: number;
  readonly address?: OrderAddressEdit;
  readonly lines?: Readonly<Record<string, OrderLineEdit>>;
  readonly deliveryMethod?: OrderDeliveryMethodEdit;
  /** Replaces the current discount wholesale (#3543). */
  readonly discount?: OrderDiscountEdit;
}
