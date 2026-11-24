/**
 * Gift CSV for the accountant (#3943, gifts spec section 12, rule C2).
 *
 * One row per gift: date, the RESOLVED customer (the same buyer across orders
 * even when a marketplace hands out a different e-mail each time), the gift, its
 * net purchase cost and the document form it carried. It is an export only: no
 * 20 zl / 100 zl threshold is computed, flagged or enforced here, because that
 * judgement belongs to the accountant. An unknown cost is an EMPTY cell, never 0.
 *
 * @module apps/api/src/analytics/http/gift-report-csv
 */
import type { Readable } from 'node:stream';
import { csvHeaderComments, csvStream, type CsvColumn } from '@openlinker/shared/csv';
import type { GiftCustomerExportRow } from '../application/services/gift-report-api.service.interface';
import { toInclusiveDay } from './export-range';
import { channelCells, type ConnectionLabels } from './connection-labels';

const money = (value: number | null): string | null => (value === null ? null : value.toFixed(2));

const GIFT_SOURCE_CELL: Record<GiftCustomerExportRow['entry']['giftSource'], string> = {
  'ol-rule': 'promotion',
  channel: 'channel',
  'cart-rule': 'shop cart rule',
  operator: 'added by hand',
  bundle: 'bundle slot',
};

export function buildGiftCustomerCsv(input: {
  rows: readonly GiftCustomerExportRow[];
  labels: ConnectionLabels;
  from: Date;
  to: Date;
  now?: Date;
}): Readable {
  const columns: CsvColumn<GiftCustomerExportRow>[] = [
    { header: 'date', value: (r) => r.entry.placedAt?.toISOString().slice(0, 10) ?? null },
    { header: 'customer_id', value: (r) => r.entry.customerId },
    { header: 'customer_name', value: (r) => r.customerName },
    { header: 'order_number', value: (r) => r.entry.orderNumber },
    { header: 'order_id', value: (r) => r.entry.internalOrderId },
    { header: 'channel', value: (r) => channelCells(input.labels, r.entry.sourceConnectionId).channel },
    { header: 'gift_sku', value: (r) => r.entry.sku },
    { header: 'gift_name', value: (r) => r.entry.name },
    { header: 'quantity', value: (r) => r.entry.quantity },
    { header: 'net_purchase_cost_unit', value: (r) => money(r.entry.unitCostNet) },
    { header: 'net_purchase_cost_total', value: (r) => money(r.entry.totalCostNet) },
    { header: 'currency', value: (r) => r.entry.currency },
    {
      header: 'source',
      value: (r) => GIFT_SOURCE_CELL[r.entry.giftSource],
    },
    { header: 'promotion', value: (r) => r.ruleName },
    { header: 'document', value: (r) => r.entry.documentForm },
  ];
  const comments = csvHeaderComments([
    { key: 'report', value: 'OpenLinker gifts per customer' },
    {
      key: 'range',
      value: `${input.from.toISOString().slice(0, 10)}..${toInclusiveDay(input.to)} (order date)`,
    },
    { key: 'cost', value: 'net (VAT-exclusive) purchase cost; empty when no cost is on file' },
    { key: 'cancelled orders', value: 'excluded' },
    { key: 'thresholds', value: 'not evaluated - the yearly limits are judged by the accountant' },
    { key: 'generated', value: (input.now ?? new Date()).toISOString() },
  ]);
  return csvStream(columns, input.rows, { comments });
}
