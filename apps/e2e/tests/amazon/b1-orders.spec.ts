/**
 * Amazon E2E part B.5 - orders (points 47-64)
 *
 * Orders come from the fake's fixtures and from the simulated buyer
 * (POST /__buyer/purchase). Simulated passes prove OpenLinker's side only.
 *
 * @module tests/amazon
 */
import { test, expect, shot, createConn, runJob, ordersOf, extIds, pollUntilHas, fakeBuy, fakePost, fakeGet, sql } from './amazon-test';
import { openWizard, fillWizard, regionWizard } from './wizard';
import { REGIONS } from '../../src/support/amazon';

const STAMP = Date.now();
const DAY = 24 * 3600 * 1000;
const firstId = (region: string, kind: string): string => {
  const prefix = region === 'eu' ? '302' : region === 'na' ? '111' : '503';
  return { plain: `${prefix}-CC0000-PLAIN00` }[kind] ?? '';
};
void firstId;

/** The fixture order id of `kind` in the region's first marketplace. */
async function fixtureId(region: string, kind: string, country?: string): Promise<string> {
  const state = await fakeGet('/__state');
  const cc = country ?? REGIONS[region as 'eu' | 'na' | 'fe'].marketplaces[0]!.country;
  const wanted = kind.toUpperCase().padEnd(7, '0').slice(0, 7);
  const hit = (state.orders[region] as string[]).find((id) => id.includes(`-${cc}`) && id.endsWith(wanted));
  if (!hit) throw new Error(`no fixture ${kind} in ${region}/${cc}`);
  return hit;
}

test('P047 the wizard offers where order sync starts (now / from), not all', async ({ page, region }) => {
  await openWizard(page);
  await fillWizard(page, regionWizard(region, 'x'));
  await expect(page.getByText('Which orders should OpenLinker import?')).toBeVisible();
  await expect(page.getByText('New orders only')).toBeVisible();
  await expect(page.getByText('Orders since a date')).toBeVisible();
  // The option is shown disabled, with the reason, rather than hidden.
  await expect(page.getByRole('radio', { name: /Every order the shop has/ })).toBeDisabled();
  await expect(page.getByText('OpenLinker cannot import the full history of this connection yet.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /New orders only/ })).toBeEnabled();
  await shot(page, region.region, 47);
});

test('P048 start mode now imports no existing orders, only new ones', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const c = await createConn(ol, { name: `now ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
  expect(c.status).toBe(201);
  await runJob(ol, 'marketplace.orders.poll', c.body.id, { limit: 100, cursorKey: 'amazon.orders.feedCursor' });
  await new Promise((r) => setTimeout(r, 4000));
  const before = await ordersOf(ol, c.body.id);
  const bought = await fakeBuy({ region: region.region, sku: `E2E-${region.marketplaces[0]!.country}-1`, qty: 1, ageMinutes: 1 });
  const rows = await pollUntilHas(ol, c.body.id, [bought]);
  await evidence('start mode now', { importedBeforePurchase: before.length, afterPurchase: extIds(rows), bought });
  expect(before).toHaveLength(0);
  expect(extIds(rows)).toEqual([bought]);
});

test('P049 start mode from imports only orders updated since that moment', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const from = new Date(Date.now() - 3.5 * DAY).toISOString();
  const c = await createConn(ol, { name: `from ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'from', from } });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const plain = await fixtureId(region.region, 'PLAIN');
  const rows = await pollUntilHas(ol, c.body.id, [plain]);
  const ids = extIds(rows);
  await evidence(`start mode from ${from}`, { imported: ids });
  expect(ids).toContain(plain);
  const old = (await fakeGet('/__state')).orders[region.region].filter((id: string) => /-(?:[A-Z]{2})(\d+)000-/.test(id)).filter((id: string) => Number(/-[A-Z]{2}(\d+)000-/.exec(id)![1]) >= 4);
  for (const id of old) expect(ids).not.toContain(id);
});

test('P050 mode all is not offered and is refused by the API', async ({ ol, region, evidence }) => {
  const res = await createConn(ol, { name: `all ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'all' } });
  await evidence('POST /connections with orderSyncStart mode all', res);
  expect(res.status).toBe(400);
  expect(JSON.stringify(res.body)).toMatch(/not supported by this adapter/);
});

test('P051 a window import imports the range once and again creates no duplicates', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const c = await createConn(ol, { name: `win ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
  const from = new Date(Date.now() - 5.5 * DAY).toISOString();
  const to = new Date(Date.now() - 1.5 * DAY).toISOString();
  const start = async (): Promise<number> => (await ol.call('POST', `/connections/${c.body.id}/order-import`, { from, to, direction: 'oldest-first' })).status;
  expect(await start()).toBe(202);
  const expected = (await fakeGet('/__state')).orders[region.region].filter((id: string) => /-[A-Z]{2}(\d+)000-/.test(id) && Number(/-[A-Z]{2}(\d+)000-/.exec(id)![1]) >= 1 && Number(/-[A-Z]{2}(\d+)000-/.exec(id)![1]) <= 4 && id.includes(`-${region.marketplaces[0]!.country}`));
  let rows = await ordersOf(ol, c.body.id);
  for (let i = 0; i < 30 && !expected.every((e: string) => extIds(rows).includes(e)); i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    rows = await ordersOf(ol, c.body.id);
  }
  const first = extIds(rows);
  expect(await start()).toBe(202);
  await new Promise((r) => setTimeout(r, 15000));
  const second = extIds(await ordersOf(ol, c.body.id));
  await evidence('window import twice', { expected, first, second });
  expect(expected.length).toBeGreaterThan(0);
  for (const e of expected) expect(first).toContain(e);
  expect(second).toEqual(first);
  expect(new Set(second).size).toBe(second.length);
});

test('P053 the feed cursor row holds since, marketplaceIds and the overlap', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const c = await createConn(ol, { name: `cur ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
  await runJob(ol, 'marketplace.orders.poll', c.body.id, { limit: 100, cursorKey: 'amazon.orders.feedCursor' });
  const rows = await sql<{ cursorKey?: string; key?: string; value?: string; cursorValue?: string }>(`select * from connection_cursors where "connectionId" = $1`, [c.body.id]);
  await evidence('connection_cursors', rows);
  const row = rows.find((r) => JSON.stringify(r).includes('amazon.orders.feedCursor'));
  expect(row).toBeTruthy();
  const raw = Object.values(row!).find((v) => typeof v === 'string' && v.startsWith('{')) as string;
  const cursor = JSON.parse(raw) as { since: string; marketplaceIds: string[] };
  expect(cursor.marketplaceIds).toEqual(region.marketplaces.map((m) => m.id));
  const age = Date.now() - Date.parse(cursor.since);
  expect(age).toBeGreaterThan(100 * 1000);
  expect(age).toBeLessThan(6 * 60 * 1000);
});

test('P054 the feed-cursor policy specs pass', async ({ evidence }) => {
  test.setTimeout(900_000);
  const { runAuto } = await import('../../src/support/amazon-auto');
  const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
  await evidence('amazon-order-feed-cursor.policy.spec.ts (inside the full plugin run)', plugin);
  expect(plugin.ok, plugin.tail).toBe(true);
});

test.describe('imported orders', () => {
  let connId = '';
  let ids: Record<string, string> = {};

  test.beforeAll(async ({ ol, region, fake }) => {
    void fake;
    await fake.reset();
    const c = await createConn(ol, { name: `ord ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'from', from: new Date(Date.now() - 8 * DAY).toISOString() } });
    connId = c.body.id;
    ids = {
      plain: await fixtureId(region.region, 'PLAIN'),
      fba: await fixtureId(region.region, 'FBA'),
      cod: await fixtureId(region.region, 'COD'),
      pending: await fixtureId(region.region, 'PENDING'),
      norole: await fixtureId(region.region, 'NOROLE'),
    };
    await pollUntilHas(ol, connId, Object.values(ids));
  });

  const byExt = async (ol: any, id: string): Promise<any> => (await ordersOf(ol, connId)).find((o) => o.orderSnapshot.externalOrderId === id);

  test('P055 an imported FBM order carries the seller SKU as product reference', async ({ page, ol, region }) => {
    const o = await byExt(ol, ids.plain!);
    const line = o.orderSnapshot.items[0];
    expect(line.sku).toMatch(/^E2E-/);
    expect(line.productRef).toEqual({ type: 'offer', externalId: line.sku });
    expect(['awaiting_mapping', 'ready']).toContain(o.recordStatus);
    await page.goto(`/orders/${o.internalOrderId}`);
    await expect(page.getByText(line.sku).first()).toBeVisible();
    await shot(page, region.region, 55);
  });

  test('P056 money: lines plus shipping equal the total, gross, no tax rate', async ({ ol, evidence }) => {
    const o = await byExt(ol, ids.plain!);
    const t = o.orderSnapshot.totals;
    const lines = o.orderSnapshot.items.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
    await evidence('plain order totals', { totals: t, lines });
    expect(Number((lines + t.shipping).toFixed(2))).toBe(t.total);
    expect(t.totalTaxTreatment).toBe('inclusive');
    for (const i of o.orderSnapshot.items) expect(i.taxRate ?? null).toBeNull();
  });

  test('P057 simulated: an order whose seller app has the recipient role stores the address', async ({ ol, evidence }) => {
    const o = await byExt(ol, ids.plain!);
    await evidence('simulated recipient role present (OpenLinker side only)', { shippingAddress: o.orderSnapshot.shippingAddress, withheld: o.orderSnapshot.metadata.amazonShippingAddressWithheld });
    expect(o.orderSnapshot.shippingAddress.address1).toBeTruthy();
    expect(o.orderSnapshot.customerEmail).toMatch(/@marketplace\.amazon\./);
    expect(o.orderSnapshot.metadata.amazonShippingAddressWithheld).toBe(false);
  });

  test('P058 an order without the recipient role has no address and says so', async ({ ol, evidence }) => {
    const o = await byExt(ol, ids.norole!);
    await evidence('order without recipient', { shippingAddress: o.orderSnapshot.shippingAddress ?? null, metadata: o.orderSnapshot.metadata });
    expect(o.orderSnapshot.shippingAddress ?? null).toBeNull();
    expect(o.orderSnapshot.metadata.amazonShippingAddressWithheld).toBe(true);
  });

  test('P059 an FBA order is marked fulfilled by the source and offers no label', async ({ page, ol, region }) => {
    const o = await byExt(ol, ids.fba!);
    expect(o.orderSnapshot.metadata.amazonFulfillmentStatus).toBe('SHIPPED');
    await page.goto(`/orders/${o.internalOrderId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /generate label|dispatch/i })).toHaveCount(0);
    await shot(page, region.region, 59);
  });

  test('P060 cash on delivery and pending payment', async ({ ol, evidence }) => {
    const cod = await byExt(ol, ids.cod!);
    const pending = await byExt(ol, ids.pending!);
    const plain = await byExt(ol, ids.plain!);
    await evidence('payment fields', { cod: [cod.orderSnapshot.paymentMethod, cod.orderSnapshot.paymentStatus], pending: [pending.orderSnapshot.paymentMethod, pending.orderSnapshot.paymentStatus], plain: [plain.orderSnapshot.paymentMethod, plain.orderSnapshot.paymentStatus] });
    expect(cod.orderSnapshot.paymentMethod).toBe('cash_on_delivery');
    expect(pending.orderSnapshot.paymentStatus).not.toBe('paid');
    expect(plain.orderSnapshot.paymentStatus).toBe('paid');
  });
});
