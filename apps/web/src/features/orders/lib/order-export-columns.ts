/**
 * Orders export — column groups, built-in presets and file naming (#3534, #3507 PR 8)
 *
 * FE-only presentation of the export's closed column vocabulary
 * (`ORDER_EXPORT_COLUMN_IDS`, mirrored from core). Core has no notion of a
 * column GROUP or a built-in preset — both are how the dialog lays the same
 * ids out (mockup M5), so they live here rather than in the wire types.
 *
 * Every group/preset entry is typed `OrderExportColumnIdValue`, so an id
 * removed from the mirror is a compile error here, not a silently dead box.
 *
 * @module apps/web/src/features/orders/lib
 */
import {
  ORDER_EXPORT_COLUMN_IDS,
  ORDER_EXPORT_DEFAULT_COLUMNS,
  ORDER_EXPORT_PII_COLUMNS,
  type OrderExportColumnIdValue,
  type OrderExportFormatValue,
} from '../api/orders.types';

export interface OrderExportColumnGroup {
  id: 'order' | 'money' | 'delivery' | 'items' | 'buyer';
  label: string;
  columns: readonly OrderExportColumnIdValue[];
}

export const ORDER_EXPORT_COLUMN_GROUPS: readonly OrderExportColumnGroup[] = [
  {
    id: 'order',
    label: 'Order',
    columns: ['orderNumber', 'internalOrderId', 'sourceConnectionId', 'placedAt', 'createdAt', 'recordStatus'],
  },
  { id: 'money', label: 'Money', columns: ['currency', 'totalAmount'] },
  { id: 'delivery', label: 'Delivery', columns: ['fulfillmentState', 'packed'] },
  { id: 'items', label: 'Items', columns: ['itemCount', 'skus'] },
  { id: 'buyer', label: 'Buyer', columns: ['customerName', 'customerEmail', 'country'] },
];

export interface OrderExportBuiltInPreset {
  id: string;
  label: string;
  columns: readonly OrderExportColumnIdValue[];
}

/**
 * Built in, not saved (mockup M5 pin 7). `default` is exactly what the job
 * writes when no columns are sent, so picking it never surprises anyone.
 */
export const ORDER_EXPORT_BUILT_IN_PRESETS: readonly OrderExportBuiltInPreset[] = [
  { id: 'builtin:default', label: 'Default', columns: ORDER_EXPORT_DEFAULT_COLUMNS },
  {
    id: 'builtin:accounting',
    label: 'Accounting',
    columns: ['orderNumber', 'placedAt', 'sourceConnectionId', 'totalAmount', 'currency', 'customerName', 'country'],
  },
  {
    id: 'builtin:warehouse',
    label: 'Warehouse',
    columns: ['orderNumber', 'createdAt', 'fulfillmentState', 'packed', 'itemCount', 'skus'],
  },
  { id: 'builtin:all', label: 'All columns', columns: ORDER_EXPORT_COLUMN_IDS },
];

const EXPORT_IDS = new Set<string>(ORDER_EXPORT_COLUMN_IDS);
const PII_IDS = new Set<string>(ORDER_EXPORT_PII_COLUMNS);

export function isOrderExportColumnId(id: string): id is OrderExportColumnIdValue {
  return EXPORT_IDS.has(id);
}

export function isOrderExportPiiColumn(id: string): boolean {
  return PII_IDS.has(id);
}

/** A saved preset's export-shaped ids, in its own order. A preset may also carry list ids (shared shape, #3530). */
export function narrowToExportColumns(columns: readonly string[]): OrderExportColumnIdValue[] {
  return columns.filter(isOrderExportColumnId);
}

/**
 * The worker's own file-name shape (`orders-export.handler.ts` `filename()`):
 * a date plus the last 8 characters of the run id. Dated off `createdAt`
 * rather than "now" so the dialog, the toast and the saved file agree with
 * each other however long the run took or whenever it is downloaded.
 */
export function orderExportFileName(
  run: { id: string; createdAt: string },
  format: OrderExportFormatValue,
): string {
  const date = run.createdAt.slice(0, 10);
  return `orders-export-${date}-${run.id.slice(-8)}.${format}`;
}

/** `1284` → `1 284` (a no-break space, so a count never wraps mid-number). */
export function formatExportCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
