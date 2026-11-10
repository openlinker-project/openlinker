/**
 * Gift cost report Integration Test (#3943)
 *
 * The report's numbers must reconcile with the order lines they are read from:
 * a channel-flagged gift line (with the cost frozen at ingestion), a gift the
 * overlay added, one added by hand, and an order that was cancelled. Also that
 * the accountant's CSV is keyed by the RESOLVED customer, not the buyer e-mail.
 * Runs the real controller against the real Postgres harness.
 *
 * @module apps/api/test/integration
 */
import type { StreamableFile } from '@nestjs/common';
import { OrderLineItemOrmEntity, OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { GiftReportController } from '../../src/analytics/http/gift-report.controller';
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';

const CONN_A = '11111111-1111-4111-8111-111111111111';
const CONN_B = '22222222-2222-4222-8222-222222222222';
const RULE_ID = '33333333-3333-4333-8333-333333333333';
const FROM = '2026-10-01T00:00:00.000Z';
const TO = '2026-11-01T00:00:00.000Z';
const STAMP = { changeId: 'c1', editedAt: '2026-10-05T10:00:00.000Z', editedBy: null };

async function readCsv(file: StreamableFile): Promise<string[]> {
  let out = '';
  for await (const chunk of file.getStream()) {
    out += String(chunk);
  }
  return out.split('\r\n').filter((l) => l.length > 0);
}

describe('Gift cost report (integration, #3943)', () => {
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

  async function seedOrder(input: {
    id: string;
    connectionId: string;
    customerId: string | null;
    items: Array<Record<string, unknown>>;
    orderEdits?: Record<string, unknown> | null;
    cancelled?: boolean;
    giftCost?: { lineNumber: number; productId: string; quantity: number; cost: string };
  }): Promise<void> {
    const ds = harness.getDataSource();
    const placedAt = new Date('2026-10-05T10:00:00.000Z');
    await ds.getRepository(OrderRecordOrmEntity).save(
      ds.getRepository(OrderRecordOrmEntity).create({
        internalOrderId: input.id,
        customerId: input.customerId,
        sourceConnectionId: input.connectionId,
        sourceEventId: null,
        orderSnapshot: { items: input.items, orderNumber: `N-${input.id}` },
        orderEdits: input.orderEdits ?? null,
        syncStatus: [],
        recordStatus: 'ready',
        cancelledAt: input.cancelled === true ? new Date('2026-10-06T10:00:00.000Z') : null,
        currency: 'PLN',
        taxTreatment: 'inclusive',
        placedAt,
        totalAmount: 100,
      })
    );
    if (input.giftCost !== undefined) {
      await ds.getRepository(OrderLineItemOrmEntity).save(
        ds.getRepository(OrderLineItemOrmEntity).create({
          orderRecordId: input.id,
          lineNumber: input.giftCost.lineNumber,
          productId: input.giftCost.productId,
          variantId: null,
          quantity: input.giftCost.quantity,
          unitPrice: 0,
          sourceConnectionId: input.connectionId,
          placedAt,
          unitCostNet: input.giftCost.cost,
          unitCostCurrency: 'PLN',
          costState: 'recorded',
        })
      );
    }
  }

  it('should reconcile units and cost with the order lines and key the CSV by resolved customer', async () => {
    // 1. A channel gift (2 pcs, frozen cost 3.00 each) beside an ordinary line.
    await seedOrder({
      id: 'ol_order_gift_1',
      connectionId: CONN_A,
      customerId: 'ol_customer_one',
      items: [
        { id: 'l0', productId: 'ol_product_paid', quantity: 1, price: 100, sku: 'PAID' },
        {
          id: 'l1',
          productId: 'ol_product_gift',
          quantity: 2,
          price: 0,
          sku: 'SPOON',
          name: 'Spoon',
          gift: { source: 'channel' },
        },
      ],
      giftCost: { lineNumber: 1, productId: 'ol_product_gift', quantity: 2, cost: '3.0000' },
    });
    // 2. A rule-added gift in the overlay: no snapshot, no catalogue cost -> unknown.
    await seedOrder({
      id: 'ol_order_gift_2',
      connectionId: CONN_A,
      customerId: 'ol_customer_one',
      items: [{ id: 'l0', productId: 'ol_product_paid', quantity: 1, price: 100, sku: 'PAID' }],
      orderEdits: {
        v: 1,
        rev: 1,
        addedLines: {
          [`ol-gift:${RULE_ID}:g1`]: {
            ...STAMP,
            productId: 'ol_product_sample',
            quantity: 3,
            sku: 'SAMPLE',
            gift: { source: 'ol-rule', ruleRef: RULE_ID, documentForm: 'priced-in' },
          },
        },
      },
    });
    // 3. A gift added by hand on another channel, another customer.
    await seedOrder({
      id: 'ol_order_gift_3',
      connectionId: CONN_B,
      customerId: 'ol_customer_two',
      items: [{ id: 'l0', productId: 'ol_product_paid', quantity: 1, price: 100, sku: 'PAID' }],
      orderEdits: {
        v: 1,
        rev: 1,
        addedLines: {
          'op-gift:c9': {
            ...STAMP,
            productId: 'ol_product_bag',
            quantity: 1,
            sku: 'BAG',
            gift: { source: 'operator' },
          },
        },
      },
    });
    // 4. A cancelled order gave nothing away.
    await seedOrder({
      id: 'ol_order_gift_4',
      connectionId: CONN_A,
      customerId: 'ol_customer_one',
      cancelled: true,
      items: [
        { id: 'l1', productId: 'ol_product_gift', quantity: 9, price: 0, gift: { source: 'channel' } },
      ],
    });

    const controller = harness.getApp().get(GiftReportController, { strict: false });
    const report = await controller.getReport({ from: FROM, to: TO });

    // Independent expectation: the gift lines of the three live orders.
    expect(report.totals).toHaveLength(1);
    expect(report.totals[0]).toMatchObject({
      currency: 'PLN',
      units: 2 + 3 + 1,
      costNet: 6, // 2 x 3.00 from the frozen snapshot
      unknownCostUnits: 3 + 1, // the overlay sample and the hand-added bag have no cost on file
      paidGross: 0,
    });
    const spoon = report.groups.find((g) => g.sku === 'SPOON');
    expect(spoon).toMatchObject({ units: 2, orders: 1, costNet: 6, unknownCostUnits: 0 });
    const sample = report.groups.find((g) => g.sku === 'SAMPLE');
    expect(sample).toMatchObject({ units: 3, ruleRef: RULE_ID, costNet: 0, unknownCostUnits: 3 });

    const byHand = await controller.getReport({ from: FROM, to: TO, giftSource: 'manual' });
    expect(byHand.totals[0]).toMatchObject({ units: 1 });
    const channelB = await controller.getReport({ from: FROM, to: TO, sourceConnectionId: CONN_B });
    expect(channelB.totals[0]).toMatchObject({ units: 1 });

    const file = await controller.exportCsv({ from: FROM, to: TO });
    const lines = await readCsv(file);
    const headerIndex = lines.findIndex((l) => l.startsWith('date,'));
    expect(headerIndex).toBeGreaterThan(0);
    const rows = lines.slice(headerIndex + 1).map((l) => l.split(','));
    expect(rows).toHaveLength(3);
    const header = lines[headerIndex].split(',');
    const col = (name: string): number => header.indexOf(name);
    const forCustomer = (id: string): string[][] => rows.filter((r) => r[col('customer_id')] === id);
    expect(forCustomer('ol_customer_one')).toHaveLength(2);
    expect(forCustomer('ol_customer_two')).toHaveLength(1);
    const spoonRow = rows.find((r) => r[col('gift_sku')] === 'SPOON') as string[];
    expect(spoonRow[col('net_purchase_cost_total')]).toBe('6.00');
    // An unknown cost is an empty cell, never 0.
    const sampleRow = rows.find((r) => r[col('gift_sku')] === 'SAMPLE') as string[];
    expect(sampleRow[col('net_purchase_cost_total')]).toBe('');
    expect(sampleRow[col('document')]).toBe('priced-in');
  });

  it('should answer an empty report for a range with no gifts', async () => {
    const controller = harness.getApp().get(GiftReportController, { strict: false });
    const report = await controller.getReport({ from: FROM, to: TO });
    expect(report).toEqual({ groups: [], series: [], totals: [] });
  });
});
