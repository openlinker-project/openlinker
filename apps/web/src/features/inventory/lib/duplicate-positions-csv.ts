/**
 * Duplicate-positions CSV export (#3071 mockup parity)
 *
 * Pure, client-side CSV builder + browser-download trigger for the
 * duplicate-positions diagnostic. One CSV row per `inventory_items` row
 * (not per group), matching the mockup's own description: "every group in
 * the table (uncapped), one row per inventory_items.id, for offline triage
 * or a support ticket."
 *
 * "Uncapped" in the mockup means the export bypasses `maxGroups`'s effect on
 * on-screen readability — but there is no dedicated uncapped export
 * endpoint, so this builds the CSV from whatever `groups[]` the CURRENT
 * response already loaded (which respects `maxGroups`). When the response is
 * `truncated`, the export is therefore also partial — the caller is expected
 * to state that explicitly rather than let the export silently under-report.
 *
 * @module apps/web/src/features/inventory/lib
 */
import type { DuplicatePositionGroup } from '../api/inventory.types';

const CSV_COLUMNS = [
  'productId',
  'productName',
  'sku',
  'productVariantId',
  'locationId',
  'locationName',
  'sourceConnectionId',
  'connectionName',
  'groupRowCount',
  'groupLiveRowCount',
  'inventoryItemId',
  'availableQuantity',
  'reservedQuantity',
  'isStale',
  'updatedAt',
] as const;

/**
 * Cells that begin with `=`, `+`, `-`, `@`, tab, or CR are interpreted as
 * formulas by Excel/Sheets/LibreOffice on open ("CSV/formula injection").
 * `productName`/`sku`/`connectionName`/`locationName` ultimately come from
 * an external shop's own catalog, not from anything the OpenLinker operator
 * authored, so they're untrusted for this purpose — prefixing with a `'`
 * (Excel's own "treat as text" escape) neutralizes the formula without
 * changing what the operator reads in a plain text/CSV viewer.
 */
const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

function csvCell(value: string | number | boolean | null): string {
  let raw = value === null ? '' : String(value);
  if (FORMULA_PREFIX_PATTERN.test(raw)) {
    raw = `'${raw}`;
  }
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/**
 * Flattens each group's rows into one CSV line each, so a spreadsheet can
 * filter/sort at `inventory_items` grain without re-deriving the group
 * fields per row.
 */
export function buildDuplicatePositionsCsv(groups: readonly DuplicatePositionGroup[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const group of groups) {
    for (const row of group.rows) {
      lines.push(
        [
          csvCell(group.productId),
          csvCell(group.productName),
          csvCell(group.sku),
          csvCell(group.productVariantId),
          csvCell(group.locationId),
          csvCell(group.locationName),
          csvCell(group.sourceConnectionId),
          csvCell(group.connectionName),
          csvCell(group.rowCount),
          csvCell(group.liveRowCount),
          csvCell(row.id),
          csvCell(row.availableQuantity),
          csvCell(row.reservedQuantity),
          csvCell(row.isStale),
          csvCell(row.updatedAt),
        ].join(',')
      );
    }
  }
  return lines.join('\n');
}

/**
 * Triggers a browser download for an in-memory CSV string via an object URL
 * + a programmatic `<a download>` click — the `triggerBlobDownload` shape
 * `useInvoiceRenderedDocumentDownload` already uses for server-fetched blobs,
 * applied here to a client-generated one. `revokeObjectURL` is deferred past
 * the current tick — some engines cancel an in-flight download if the URL is
 * revoked synchronously after `click()`.
 */
export function triggerDuplicatePositionsCsvDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
