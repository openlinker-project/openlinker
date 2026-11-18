/**
 * Amazon Return Mapper (#4184)
 *
 * Turns the rows of the seller-fulfilled returns report
 * (`GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE`) into returns. The report has
 * one row per returned item, so rows sharing an Amazon RMA id are one return.
 *
 *   - id: the Amazon RMA id; order: the Amazon order id.
 *   - status: the report's return request status, verbatim. `Closed` and
 *     `Rejected` are terminal at Amazon (compared without case).
 *   - created: the return request date; a date Amazon writes in a form this
 *     mapper cannot read falls back to the end of the report window, the
 *     latest moment the request can have been made.
 *   - lines: SKU, ASIN, title, returned quantity, Amazon's return reason and,
 *     when the row carries the order amount and quantity, the unit price.
 *
 * Column names follow Amazon's report documentation and are not yet verified
 * on a live account (#4184 research criterion).
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */
import type { IncomingReturn, IncomingReturnLine } from '@openlinker/core/returns';

import type { AmazonFlatFileRow } from './amazon-flat-file';

/** Return request statuses after which Amazon changes nothing more. */
export const AMAZON_TERMINAL_RETURN_STATUSES = ['Closed', 'Rejected', 'CLOSED', 'REJECTED', 'closed', 'rejected'] as const;

export interface AmazonReturnLineRow {
  readonly sku: string | null;
  readonly asin: string | null;
  readonly name: string | null;
  readonly quantity: number;
  readonly reason: string | null;
  readonly unitPrice: number | null;
}

/** One return as the report states it; kept in the cache between reads. */
export interface AmazonReturnObservation {
  readonly rmaId: string;
  readonly orderId: string | null;
  readonly status: string;
  /** ISO 8601. */
  readonly requestedAt: string;
  readonly lines: readonly AmazonReturnLineRow[];
}

export function isTerminalAmazonReturnStatus(status: string): boolean {
  const lower = status.trim().toLowerCase();
  return lower === 'closed' || lower === 'rejected';
}

/** Rows grouped by RMA id, in report order; a row without an RMA id is skipped. */
export function groupAmazonReturnRows(rows: readonly AmazonFlatFileRow[], windowEnd: string): AmazonReturnObservation[] {
  const byRma = new Map<string, AmazonFlatFileRow[]>();
  for (const row of rows) {
    const rma = row.amazonrmaid ?? '';
    if (rma.length === 0) continue;
    byRma.set(rma, [...(byRma.get(rma) ?? []), row]);
  }
  return [...byRma.entries()].map(([rmaId, group]) => {
    const first = group[0];
    return {
      rmaId,
      orderId: nonEmpty(first.orderid),
      status: nonEmpty(first.returnrequeststatus) ?? 'Unknown',
      requestedAt: toIso(first.returnrequestdate) ?? windowEnd,
      lines: group.map(toLine),
    };
  });
}

export function toIncomingReturn(observation: AmazonReturnObservation): IncomingReturn {
  const lines: IncomingReturnLine[] = observation.lines.map((line, index) => ({
    externalLineId: String(index + 1),
    ...(line.asin ? { offerId: line.asin } : {}),
    ...(line.sku ? { sku: line.sku } : {}),
    ...(line.name ? { name: line.name } : {}),
    quantity: line.quantity,
    ...(line.unitPrice !== null ? { unitPrice: line.unitPrice } : {}),
    ...(line.reason ? { reasonRaw: line.reason } : {}),
  }));
  return {
    externalReturnId: observation.rmaId,
    externalOrderId: observation.orderId,
    referenceNumber: observation.rmaId,
    rawStatus: observation.status,
    createdAt: observation.requestedAt,
    isTerminalAtSource: isTerminalAmazonReturnStatus(observation.status),
    lines,
    raw: observation,
  };
}

function toLine(row: AmazonFlatFileRow): AmazonReturnLineRow {
  const quantity = toNumber(row.returnquantity);
  const orderAmount = toNumber(row.orderamount);
  const orderQuantity = toNumber(row.orderquantity);
  return {
    sku: nonEmpty(row.merchantsku),
    asin: nonEmpty(row.asin),
    name: nonEmpty(row.itemname),
    quantity: quantity !== null && quantity > 0 ? Math.floor(quantity) : 1,
    reason: nonEmpty(row.returnreason),
    unitPrice:
      orderAmount !== null && orderQuantity !== null && orderQuantity > 0
        ? Math.round((orderAmount / orderQuantity) * 100) / 100
        : null,
  };
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim().length > 0 ? value.trim() : null;
}

/** Amounts may use a decimal comma in European reports. */
function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const number = Number(value.trim().replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function toIso(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
