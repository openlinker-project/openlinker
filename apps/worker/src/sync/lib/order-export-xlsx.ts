/**
 * Order Export XLSX Writer (#3534, mockup M5)
 *
 * The XLSX sibling of `buildOrderExportCsv` (`@openlinker/core/orders`) —
 * SAME row projection (`resolveOrderExportCell`), so the two formats can
 * never report different figures for the same order (AC).
 *
 * `exceljs` is a worker-only dependency: nothing else in the tree writes a
 * spreadsheet, and the writer is streamed into a `Buffer` via
 * `xlsx.writeBuffer()` rather than written to a temp file, since the result
 * is stored inline as base64 on the `order_exports` row (#3534's
 * `StoredDocument` pattern) — there is no filesystem in the loop.
 *
 * @module apps/worker/src/sync/lib
 */
import ExcelJS from 'exceljs';
import {
  ORDER_EXPORT_COLUMN_LABELS,
  resolveOrderExportCell,
  type OrderExportColumnId,
} from '@openlinker/core/orders';
import type { OrderRecord } from '@openlinker/core/orders';

/**
 * @param storePii the CURRENT `OL_STORE_PII` setting at generation time
 *   (default `true`, preserving every pre-existing call site) — threaded
 *   into `resolveOrderExportCell` so a PII column is blanked unconditionally
 *   rather than trusting whatever a previously-ingested row's snapshot
 *   happens to carry. See that function's own docblock.
 */
export async function buildOrderExportXlsx(
  orders: readonly OrderRecord[],
  columns: readonly OrderExportColumnId[],
  storePii = true
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Orders');

  sheet.columns = columns.map((c) => ({
    header: ORDER_EXPORT_COLUMN_LABELS[c],
    key: c,
    width: 20,
  }));

  for (const order of orders) {
    const row: Record<string, string | number | boolean | null> = {};
    for (const column of columns) {
      row[column] = resolveOrderExportCell(order, column, storePii);
    }
    sheet.addRow(row);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
