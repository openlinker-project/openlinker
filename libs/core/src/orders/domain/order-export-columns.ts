/**
 * Order Export Row Projection (#3534, D35, mockup M5)
 *
 * A closed vocabulary of exportable columns plus the pure extraction of one
 * order's cell values, shared by BOTH writers (CSV in this module, XLSX in
 * the worker's `exceljs`-backed builder) so the two file formats can never
 * report different numbers for the same order (AC: "CSV and XLSX are
 * produced from one shared row projection").
 *
 * Column ids are intentionally NOT the same open, frontend-owned vocabulary
 * `OrderColumnPreset.columns` uses for the LIST (`order-column-preset.types.ts`'s
 * own docblock: "the set of renderable list columns is owned by the
 * frontend"). The export needs a CLOSED, server-resolvable set — a preset
 * column id this list does not recognise is silently skipped, exactly as
 * that docblock already prescribes for an unrecognised key on the list side.
 *
 * PII handling mirrors what `deriveOrderSearchText` already documents: with
 * `OL_STORE_PII=false` the snapshot already carries `[REDACTED]` addresses
 * and omits the buyer email outright (`order-address-redaction.ts`,
 * `order-record.service.ts`). This module never writes the literal
 * `[REDACTED]` string into an exported cell — it reads that sentinel back
 * out to an EMPTY cell, per #3534's own "Backend gaps" note ("the export
 * writes empty cells (never `[REDACTED]`), country stays").
 *
 * @module libs/core/src/orders/domain
 */
import { REDACTED_PLACEHOLDER } from './order-address-redaction';
import type { OrderRecord } from './entities/order-record.entity';

export const ORDER_EXPORT_COLUMN_IDS = [
  'internalOrderId',
  'orderNumber',
  'sourceConnectionId',
  'customerName',
  'customerEmail',
  'country',
  'placedAt',
  'createdAt',
  'recordStatus',
  'currency',
  'totalAmount',
  'itemCount',
  'skus',
  'packed',
  'fulfillmentState',
] as const;
export type OrderExportColumnId = (typeof ORDER_EXPORT_COLUMN_IDS)[number];

/**
 * Columns carrying buyer PII. Under `OL_STORE_PII=false` these are written
 * EMPTY unconditionally (#3534 fix, live-verified discrepancy) — never
 * derived from what happens to sit in `order.orderSnapshot`, because a row
 * ingested while PII storage was still on carries the buyer's real name/
 * email in the snapshot verbatim; flipping the flag later does not
 * retroactively redact already-stored rows. `country` is not PII (kept by
 * `redactAddress` itself) and stays out of this set.
 */
export const ORDER_EXPORT_PII_COLUMNS: readonly OrderExportColumnId[] = [
  'customerName',
  'customerEmail',
];

export const ORDER_EXPORT_COLUMN_LABELS: Record<OrderExportColumnId, string> = {
  internalOrderId: 'Order ID',
  orderNumber: 'Order #',
  sourceConnectionId: 'Source connection',
  customerName: 'Buyer name',
  customerEmail: 'Buyer email',
  country: 'Country',
  placedAt: 'Placed',
  createdAt: 'Received',
  recordStatus: 'Record status',
  currency: 'Currency',
  totalAmount: 'Total',
  itemCount: 'Items',
  skus: 'SKUs',
  packed: 'Packed',
  fulfillmentState: 'Fulfillment',
};

/** A cell value — kept to the primitives every writer (CSV/XLSX) can render directly. */
export type OrderExportCellValue = string | number | boolean | null;

function readSnapshotString(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value === REDACTED_PLACEHOLDER ? null : value;
}

function readAddressName(snapshot: Record<string, unknown>, key: 'billingAddress' | 'shippingAddress'): string | null {
  const raw = snapshot[key];
  if (typeof raw !== 'object' || raw === null) return null;
  const address = raw as Record<string, unknown>;
  const first = typeof address.firstName === 'string' ? address.firstName : '';
  const last = typeof address.lastName === 'string' ? address.lastName : '';
  const name = `${first} ${last}`.trim();
  if (name.length === 0 || name === `${REDACTED_PLACEHOLDER} ${REDACTED_PLACEHOLDER}`) return null;
  return name;
}

function readAddressCountry(snapshot: Record<string, unknown>, key: 'billingAddress' | 'shippingAddress'): string | null {
  const raw = snapshot[key];
  if (typeof raw !== 'object' || raw === null) return null;
  const address = raw as Record<string, unknown>;
  // Country survives redaction (`order-address-redaction.ts`: "country is kept").
  return typeof address.country === 'string' && address.country.length > 0 ? address.country : null;
}

function readItems(snapshot: Record<string, unknown>): { count: number; skus: string } {
  const items = snapshot.items;
  if (!Array.isArray(items)) return { count: 0, skus: '' };
  const skus: string[] = [];
  for (const item of items) {
    if (typeof item === 'object' && item !== null) {
      const sku = (item as Record<string, unknown>).sku;
      if (typeof sku === 'string' && sku.length > 0) skus.push(sku);
    }
  }
  return { count: items.length, skus: skus.join('; ') };
}

function readTotals(snapshot: Record<string, unknown>): { currency: string | null; total: number | null } {
  const totals = snapshot.totals;
  if (typeof totals !== 'object' || totals === null) return { currency: null, total: null };
  const t = totals as Record<string, unknown>;
  const total = typeof t.total === 'number' ? t.total : null;
  const currency = typeof snapshot.currency === 'string' ? snapshot.currency : null;
  return { currency, total };
}

/**
 * Resolve ONE cell for ONE column against an already-loaded `OrderRecord`.
 *
 * `storePii` (default `true`, preserving every pre-existing call site) is the
 * CURRENT `OL_STORE_PII` setting at generation time, never a property of the
 * snapshot itself: with it `false`, a PII column ({@link ORDER_EXPORT_PII_COLUMNS})
 * is blanked unconditionally, before the snapshot is even read, because a row
 * ingested while PII storage was on still carries the buyer's real data
 * verbatim — the `[REDACTED]`-sentinel checks below only ever catch a row
 * that was ALSO redacted at ingestion time, which is a different (and, for
 * an existing install, usually empty) set.
 */
export function resolveOrderExportCell(
  order: OrderRecord,
  column: OrderExportColumnId,
  storePii = true,
): OrderExportCellValue {
  if (!storePii && (ORDER_EXPORT_PII_COLUMNS as readonly string[]).includes(column)) {
    return null;
  }
  const snapshot = order.orderSnapshot;
  switch (column) {
    case 'internalOrderId':
      return order.internalOrderId;
    case 'orderNumber':
      return readSnapshotString(snapshot, 'orderNumber');
    case 'sourceConnectionId':
      return order.sourceConnectionId;
    case 'customerName':
      return readAddressName(snapshot, 'billingAddress') ?? readAddressName(snapshot, 'shippingAddress');
    case 'customerEmail':
      return readSnapshotString(snapshot, 'customerEmail');
    case 'country':
      return readAddressCountry(snapshot, 'shippingAddress') ?? readAddressCountry(snapshot, 'billingAddress');
    case 'placedAt':
      return order.placedAt ? order.placedAt.toISOString() : null;
    case 'createdAt':
      return order.createdAt.toISOString();
    case 'recordStatus':
      return order.recordStatus;
    case 'currency':
      return readTotals(snapshot).currency;
    case 'totalAmount':
      return readTotals(snapshot).total;
    case 'itemCount':
      return readItems(snapshot).count;
    case 'skus':
      return readItems(snapshot).skus;
    case 'packed':
      return order.packedAt !== null;
    case 'fulfillmentState':
      return order.fulfillmentState;
    default: {
      const exhaustive: never = column;
      return exhaustive;
    }
  }
}

/** Narrow an arbitrary preset column id string down to the closed export vocabulary. Unrecognised ids are skipped. */
export function narrowOrderExportColumns(columns: readonly string[]): OrderExportColumnId[] {
  const known = new Set<string>(ORDER_EXPORT_COLUMN_IDS);
  return columns.filter((c): c is OrderExportColumnId => known.has(c));
}

/** The default column set when the caller supplies none, or every supplied id was unrecognised. */
export const ORDER_EXPORT_DEFAULT_COLUMNS: readonly OrderExportColumnId[] = [
  'orderNumber',
  'customerName',
  'placedAt',
  'currency',
  'totalAmount',
  'itemCount',
  'recordStatus',
];
