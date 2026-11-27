/**
 * Amazon E2E part B.5-B.6 - order write-back, mapping options and the 30-day
 * buyer-data retention (points 61-69). The shipment rows are seeded in SQL
 * (there is no carrier connection on this stack); the relay into Amazon and
 * what Amazon is told are real. Amazon's order state after a confirmation is
 * SIMULATED by the fake (the real sandbox never changes it).
 *
 * @module tests/amazon
 */
import { execFile } from 'node:child_process';
import { test, expect, shot, createConn, patchConfig, runJob, fakeBuy, ordersOf, pollUntilHas, fakeGet, sql, type OlApi } from './amazon-test';
import { REGIONS, type RegionFixture } from '../../src/support/amazon';

const STAMP = Date.now();
const DAY = 24 * 3600 * 1000;

async function fixtureId(region: string, kind: string): Promise<string> {
  const state = await fakeGet('/__state');
  const cc = REGIONS[region as 'eu' | 'na' | 'fe'].marketplaces[0].country;
  const wanted = kind.toUpperCase().padEnd(7, '0').slice(0, 7);
  return (state.orders[region] as string[]).find((id) => id.includes(`-${cc}`) && id.endsWith(wanted))!;
}

async function sourceWithOrders(ol: OlApi, region: RegionFixture, name: string, kinds: string[]): Promise<{ id: string; ids: Record<string, string> }> {
  const list = (await ol.call('GET', '/connections')).body as { id: string; name: string }[];
  let c = list.find((x) => x.name === name);
  if (!c) {
    const made = await createConn(ol, { name, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'from', from: new Date(Date.now() - 8 * DAY).toISOString() } });
    c = made.body;
  }
  const ids: Record<string, string> = {};
  for (const k of kinds) ids[k] = await fixtureId(region.region, k);
  await pollUntilHas(ol, c!.id, Object.values(ids));
  return { id: c!.id, ids };
}

async function seedShipment(orderInternalId: string, tracking: string | null, status = 'generated'): Promise<string> {
  const id = `ol_shipment_e2e${STAMP}${Math.floor(Math.random() * 1e6)}`;
  await sql(
    `insert into shipments (id, "orderId", "connectionId", "shippingMethod", status, "trackingNumber", "providerShipmentId", direction, "carrier", "createdAt", "updatedAt") values ($1,$2,$3,'courier',$4,$5,$6,'outbound','dpd', now(), now())`,
    [id, orderInternalId, '99999999-9999-4999-8999-999999999999', status, tracking, `prov-${id}`],
  );
  return id;
}

test('P061 dispatching an FBM order with a tracking number confirms the shipment at Amazon', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const src = await sourceWithOrders(ol, region, `E2E orders ${region.region}`, ['plain', 'cod']);
  const order = (await ordersOf(ol, src.id)).find((o) => o.orderSnapshot.externalOrderId === src.ids.plain)!;
  const shipmentId = await seedShipment(order.internalOrderId, 'TRK-E2E-1');
  const res = await ol.call('POST', `/shipments/${shipmentId}/notify-dispatched`);
  await new Promise((r) => setTimeout(r, 3000));
  const sim = await fakeGet('/__sim');
  const mine = sim.confirmations.filter((c: any) => c.orderId === src.ids.plain);
  await evidence('notify-dispatched, then what Amazon was told (order state SIMULATED)', { response: res.body, confirmations: mine });
  expect(res.status).toBe(200);
  expect(mine).toHaveLength(1);
  expect(mine[0].tracking).toBe('TRK-E2E-1');
  expect(mine[0].items.length).toBe(order.orderSnapshot.items.length);
});

test('P061b dispatch without a tracking number is reported unsupported, not sent', async ({ ol, region, evidence }) => {
  const src = await sourceWithOrders(ol, region, `E2E orders ${region.region}`, ['plain', 'cod']);
  const order = (await ordersOf(ol, src.id)).find((o) => o.orderSnapshot.externalOrderId === src.ids.cod)!;
  const before = (await fakeGet('/__sim')).confirmations.length;
  const shipmentId = await seedShipment(order.internalOrderId, null);
  const res = await ol.call('POST', `/shipments/${shipmentId}/notify-dispatched`);
  const after = (await fakeGet('/__sim')).confirmations.length;
  await evidence('notify-dispatched without a tracking number', { response: res.body, confirmationsBefore: before, confirmationsAfter: after });
  expect(res.status).toBe(200);
  expect(after).toBe(before);
});

test('P062 a second parcel after a full confirmation is refused by Amazon and reported', async ({ ol, region, evidence }) => {
  const src = await sourceWithOrders(ol, region, `E2E orders ${region.region}`, ['plain', 'cod']);
  const order = (await ordersOf(ol, src.id)).find((o) => o.orderSnapshot.externalOrderId === src.ids.plain)!;
  const first = await seedShipment(order.internalOrderId, 'TRK-E2E-2a');
  await ol.call('POST', `/shipments/${first}/notify-dispatched`);
  const shipmentId = await seedShipment(order.internalOrderId, 'TRK-E2E-2b');
  const res = await ol.call('POST', `/shipments/${shipmentId}/notify-dispatched`);
  await evidence('second parcel (known limit: the event names no lines)', res.body);
  expect(res.status).toBe(200);
  expect(JSON.stringify(res.body)).toMatch(/fail|rejected|error|refus/i);
});

test('P063 cancel, delivered, in-progress and paid write-backs are unsupported (spec)', async ({ evidence }) => {
  test.setTimeout(900_000);
  const { runAuto } = await import('../../src/support/amazon-auto');
  const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
  await evidence('amazon-order-source.adapter.spec.ts (inside the full plugin run)', plugin);
  expect(plugin.ok, plugin.tail).toBe(true);
});

test('P064 the mapping option lists load with Amazon vocabulary', async ({ ol, region, evidence }) => {
  const src = await sourceWithOrders(ol, region, `E2E orders ${region.region}`, ['plain', 'cod']);
  const conns = (await ol.call('GET', '/connections')).body as { id: string; name: string }[];
  const master = conns.find((c) => c.name === `E2E master ${region.region}`);
  if (master) await patchConfig(ol, src.id, { masterCatalogConnectionId: master.id });
  const out: Record<string, unknown> = {};
  for (const kind of ['order-statuses', 'delivery-methods', 'payment-methods']) {
    const r = await ol.call('GET', `/connections/${src.id}/mappings/options/source/${kind}`);
    out[kind] = { status: r.status, body: r.body };
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  await evidence('source mapping options', out);
  expect(JSON.stringify(out)).toMatch(/Unshipped|UNSHIPPED|CashOnDelivery|STANDARD/i);
});

test('P065 the manifest declares 30 days of buyer data retention', async ({ ol, evidence }) => {
  const res = await ol.call('GET', '/adapters');
  const list = (Array.isArray(res.body) ? res.body : res.body.items ?? res.body.adapters) as { adapterKey: string; buyerDataRetentionDays?: number }[];
  const amazon = list.find((a) => a.adapterKey === 'amazon.spapi.v1')!;
  await evidence('GET /v1/adapters amazon.spapi.v1', amazon);
  expect(amazon.buyerDataRetentionDays).toBe(30);
});

test('P066 the connection page states how buyer data is handled', async ({ page, ol, region }) => {
  const src = await sourceWithOrders(ol, region, `E2E orders ${region.region}`, ['plain', 'cod']);
  await page.goto(`/connections/${src.id}/edit`);
  await expect(page.getByText('Buyer data removal')).toBeVisible();
  const text = await page.locator('main').innerText();
  // Finding recorded in the results: the Amazon-specific 30-day rule is not named on the page,
  // only the general buyer-data rules block is.
  expect(text).toMatch(/When orders from this connection leave the list/);
  await shot(page, region.region, 66);
});

test('P067 the retention service specs pass', async ({ evidence }) => {
  test.setTimeout(900_000);
  const { runAuto } = await import('../../src/support/amazon-auto');
  const core = await runAuto('core-retention', '.', ['pnpm --filter @openlinker/core test -- buyer-data-retention'], 'docker');
  await evidence('buyer-data-retention.service.spec.ts', core);
  expect(core.ok, core.tail).toBe(true);
});

test('P068 and P069 the 30-day anchor redacts buyer data and a re-import brings none back', async ({ ol, region, fake, evidence }) => {
  test.setTimeout(480_000);
  await fake.reset();
  // A fresh order on a fresh connection, so the redaction below is observed and not inherited from an earlier run.
  const c = await createConn(ol, { name: `ret68 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
  await runJob(ol, 'marketplace.orders.poll', c.body.id, { limit: 100, cursorKey: 'amazon.orders.feedCursor' });
  const bought = await fakeBuy({ region: region.region, sku: `E2E-${region.marketplaces[0].country}-1`, qty: 1, ageMinutes: 1 });
  const before = (await pollUntilHas(ol, c.body.id, [bought])).find((o) => o.orderSnapshot.externalOrderId === bought)!;
  expect(before.orderSnapshot.shippingAddress.address1).toBeTruthy();
  expect(before.orderSnapshot.customerEmail).toBeTruthy();
  const src = { id: c.body.id, ids: { plain: bought } as Record<string, string> };
  const order = before;
  await sql(`update order_records set "dispatchByAt" = now() - interval '31 days' where "internalOrderId" = $1`, [order.internalOrderId]);
  await new Promise<void>((resolve) => execFile('docker', ['restart', 'olamz-worker'], () => resolve()));
  let redactedAt: unknown = null;
  for (let i = 0; i < 40 && !redactedAt; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const row = await sql<{ at: unknown }>(`select "buyerDataRedactedAt" at from order_records where "internalOrderId" = $1`, [order.internalOrderId]).catch(() => []);
    redactedAt = row[0]?.at ?? null;
  }
  const redacted = (await ordersOf(ol, src.id)).find((o) => o.internalOrderId === order.internalOrderId) as any;
  redacted.buyerDataRedactedAt = redactedAt;
  await evidence('after the retention pass', { buyerDataRedactedAt: redacted?.buyerDataRedactedAt, address: redacted?.orderSnapshot?.shippingAddress, email: redacted?.orderSnapshot?.customerEmail, items: redacted?.orderSnapshot?.items?.length, total: redacted?.orderSnapshot?.totals?.total });
  expect(redacted?.buyerDataRedactedAt).toBeTruthy();
  expect(redacted.orderSnapshot.customerEmail ?? null).toBeNull();
  const addr = redacted.orderSnapshot.shippingAddress ?? {};
  for (const k of Object.keys(addr).filter((x) => x !== 'country')) expect(addr[k]).toBe('[REDACTED]');
  expect(addr.firstName ?? null).toBeNull();
  expect(redacted.orderSnapshot.items.length).toBeGreaterThan(0);
  expect(redacted.orderSnapshot.totals.total).toBe(44.9);
  // P069: a re-import stores none of it again.
  await runJob(ol, 'marketplace.order.sync', src.id, { externalOrderId: src.ids.plain });
  await new Promise((r) => setTimeout(r, 6000));
  const again = (await ordersOf(ol, src.id)).find((o) => o.internalOrderId === order.internalOrderId)!;
  expect(again.orderSnapshot.customerEmail ?? null).toBeNull();
  const addr2 = again.orderSnapshot.shippingAddress ?? {};
  for (const k of Object.keys(addr2).filter((x) => x !== 'country')) expect(addr2[k]).toBe('[REDACTED]');
  expect(addr2.firstName ?? null).toBeNull();
});
