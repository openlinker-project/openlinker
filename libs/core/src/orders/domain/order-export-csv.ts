/**
 * Order Export CSV Writer (#3534, mockup M5)
 *
 * UTF-8 with a BOM (Polish Excel default) and semicolons rather than commas
 * — the same choice #3534's "Backend gaps" note prescribes and the one
 * `apps/web/src/features/inventory/lib/duplicate-positions-csv.ts` makes for
 * the same reason. Formula-injection protection follows that module's own
 * rule, ported here (not imported: that file is FE-only, `apps/web` never
 * imports `@openlinker/core`, #591, and the two are pure string transforms
 * cheap enough to duplicate rather than share).
 *
 * @module libs/core/src/orders/domain
 */
import type { OrderExportCellValue, OrderExportColumnId } from './order-export-columns';
import { ORDER_EXPORT_COLUMN_LABELS, resolveOrderExportCell } from './order-export-columns';
import type { OrderRecord } from './entities/order-record.entity';

/** Excel/Sheets/LibreOffice formula-injection guard — see `duplicate-positions-csv.ts`'s docblock. */
const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

function csvCell(value: OrderExportCellValue): string {
  const raw = value === null ? '' : String(value);
  // Scoped to STRING cells only — `totalAmount`/`itemCount` are legitimate
  // numbers and must never be prefixed (the `duplicate-positions-csv.ts`
  // rule, #3264 review).
  const escaped =
    typeof value === 'string' && FORMULA_PREFIX_PATTERN.test(raw) ? `'${raw}` : raw;
  return /["\r\n;]/.test(escaped) ? `"${escaped.replace(/"/g, '""')}"` : escaped;
}

/** UTF-8 BOM, so Excel on a Polish locale opens the file with the right encoding rather than guessing. */
const UTF8_BOM = '﻿';

export function buildOrderExportCsv(
  orders: readonly OrderRecord[],
  columns: readonly OrderExportColumnId[],
): string {
  const lines = [columns.map((c) => csvCell(ORDER_EXPORT_COLUMN_LABELS[c])).join(';')];
  for (const order of orders) {
    lines.push(columns.map((c) => csvCell(resolveOrderExportCell(order, c))).join(';'));
  }
  return UTF8_BOM + lines.join('\r\n');
}
