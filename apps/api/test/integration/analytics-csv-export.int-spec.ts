/**
 * Analytics CSV export Integration Test (#3589)
 *
 * The CSV is built from the SAME service call as the JSON, so the rows and
 * totals must match it exactly. Runs the real controllers against the real
 * Postgres harness.
 *
 * @module apps/api/test/integration
 */
import type { StreamableFile } from '@nestjs/common';
import { OrderLineItemOrmEntity, OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { SalesAnalyticsController } from '../../src/analytics/http/sales-analytics.controller';
import { TopProductsController } from '../../src/analytics/http/top-products.controller';
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';

const CONN_A = '11111111-1111-4111-8111-111111111111';
const CONN_B = '22222222-2222-4222-8222-222222222222';
const FROM = '2026-08-01T00:00:00.000Z';
const TO = '2026-08-08T00:00:00.000Z';

async function readCsv(file: StreamableFile): Promise<string[]> {
  let out = '';
  for await (const chunk of file.getStream()) {
    out += String(chunk);
  }
  return out.split('\r\n').filter((l) => l.length > 0);
}

describe('Analytics CSV export (integration, #3589)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seed(
    id: string,
    connectionId: string,
    productId: string,
    amount: number,
    quantity: number
  ): Promise<void> {
    const ds = harness.getDataSource();
    await ds.getRepository(OrderRecordOrmEntity).save(
      ds.getRepository(OrderRecordOrmEntity).create({
        internalOrderId: id,
        customerId: null,
        sourceConnectionId: connectionId,
        sourceEventId: null,
        orderSnapshot: { items: [] },
        syncStatus: [],
        recordStatus: 'ready',
        cancelledAt: null,
        currency: 'EUR',
        taxTreatment: 'inclusive',
        placedAt: new Date('2026-08-02T10:00:00.000Z'),
        totalAmount: amount,
        reportingCurrency: 'EUR',
        reportingTotalAmount: amount,
      })
    );
    await ds.getRepository(OrderLineItemOrmEntity).save(
      ds.getRepository(OrderLineItemOrmEntity).create({
        orderRecordId: id,
        lineNumber: 0,
        productId,
        variantId: null,
        quantity,
        unitPrice: amount / quantity,
        sourceConnectionId: connectionId,
        placedAt: new Date('2026-08-02T10:00:00.000Z'),
      })
    );
  }

  it('should write the same channel rows and totals as the JSON response', async () => {
    await seed('ol_order_csv_1', CONN_A, 'ol_product_csv_1', 100, 2);
    await seed('ol_order_csv_2', CONN_A, 'ol_product_csv_2', 50, 1);
    await seed('ol_order_csv_3', CONN_B, 'ol_product_csv_1', 70, 7);
    const controller = harness.getApp().get(SalesAnalyticsController, { strict: false });

    const json = await controller.getSalesAnalytics({ from: FROM, to: TO });
    const file = (await controller.getSalesAnalytics({
      from: FROM,
      to: TO,
      format: 'csv',
      basis: 'gross',
    })) as StreamableFile;
    const lines = await readCsv(file);

    expect(lines[0]).toContain('# report:');
    const headerIndex = lines.findIndex((l) => l.startsWith('channel,'));
    expect(headerIndex).toBeGreaterThan(0);
    expect(lines.slice(1, headerIndex).every((l) => l.startsWith('# '))).toBe(true);
    const dataRows = lines.slice(headerIndex + 1);
    expect(dataRows).toHaveLength(json.channels.length + 1);
    for (const channel of json.channels) {
      const row = dataRows.find((l) => l.startsWith(`${channel.sourceConnectionId},`));
      expect(row).toBeDefined();
      const cells = (row as string).split(',');
      expect(Number(cells[2])).toBeCloseTo(channel.revenue, 2);
      expect(Number(cells[3])).toBe(channel.orderCount);
    }
    const total = dataRows[dataRows.length - 1].split(',');
    expect(total[0]).toBe('Total');
    expect(Number(total[2])).toBeCloseTo(
      json.channels.reduce((acc, c) => acc + c.revenue, 0),
      2
    );
    expect(file.getHeaders().disposition).toMatch(/openlinker_sales-by-channel_2026-08-01_2026-08-07_EUR_gross\.csv/);
  });

  it('should write the full top-products ranking, matching the JSON order and figures', async () => {
    await seed('ol_order_csv_4', CONN_A, 'ol_product_csv_1', 100, 2);
    await seed('ol_order_csv_5', CONN_B, 'ol_product_csv_2', 300, 3);
    const controller = harness.getApp().get(TopProductsController, { strict: false });

    const json = await controller.getTopProducts({ from: FROM, to: TO, sortBy: 'revenue' });
    const file = (await controller.getTopProducts({
      from: FROM,
      to: TO,
      sortBy: 'revenue',
      limit: 1,
      offset: 0,
      format: 'csv',
    })) as StreamableFile;
    const lines = await readCsv(file);
    const headerIndex = lines.findIndex((l) => l.startsWith('product,'));
    const dataRows = lines.slice(headerIndex + 1);

    expect(headerIndex).toBeGreaterThan(0);
    expect(dataRows).toHaveLength(json.total);
    json.items.forEach((item, i) => {
      const cells = dataRows[i].split(',');
      expect(cells[1]).toBe(item.productId);
      expect(Number(cells[3])).toBeCloseTo(item.revenue, 2);
      expect(Number(cells[5])).toBe(item.units);
    });
  });
});
