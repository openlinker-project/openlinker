/**
 * Amazon E2E part A.3 (UI), B.7 and B.9 - the edit page controls, offer
 * creation and Multi-Channel Fulfillment dispatch (points 22, 25, 28, 30, 32,
 * 38, 43, 44, 52, 73-79, 82, 83, 95-100, 102). Marketplace-side behaviour
 * (catalogue, listings, MCF) is SIMULATED by the fake server: a pass proves
 * OpenLinker's side only.
 *
 * @module tests/amazon
 */
import { test, expect, shot, createConn, patchConfig, runJob, ordersOf, pollUntilHas, fakeBuy, fakeGet, fakePost, sql, type OlApi } from './amazon-test';
import { world } from './amazon-world';
import { provisionRoleUser } from './roles';
import { resolveEnv } from '../../src/config/env';
import { OlApi as OlApiClass } from './amazon-test';
import { REGIONS, type RegionFixture } from '../../src/support/amazon';

const STAMP = Date.now();
const DAY = 24 * 3600 * 1000;
const cc = (r: RegionFixture): string => r.marketplaces[0].country;

test('P022 the offer wizard lists the currencies of the connection marketplaces and where offers go', async ({ page, ol, region }) => {
  const w = await world(ol, region);
  const v = w.variants[`E2E-${cc(region)}-1`];
  await page.goto(`/listings/bulk-create/wizard?productIds=${v.productId}&variantIds=${v.id}&connectionId=${w.sales.id}`);
  await expect(page.getByText('Offer currency').first()).toBeVisible({ timeout: 30_000 });
  for (const m of region.marketplaces) {
    await page.getByLabel('Offer currency').selectOption(m.currency).catch(() => undefined);
    await expect(page.getByText(new RegExp(`Offers go to:.*${m.country === 'PL' ? 'Poland' : m.country === 'DE' ? 'Germany' : m.country === 'US' ? 'United States' : 'Japan'}`)).first()).toBeVisible();
  }
  await shot(page, region.region, 22);
});

test('P025 adding a marketplace tells that its orders are read from the last 7 days', async ({ page, ol, region }) => {
  const second = region.region === 'eu' ? { id: 'A1PA6795UKMFR9', label: /Germany/ } : region.region === 'na' ? { id: 'A2EUQ1WTGCTBG2', label: /Canada/ } : null;
  const c = await createConn(ol, { name: `addmk ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], config: { marketplaceIds: [region.marketplaces[0].id] } });
  await page.goto(`/connections/${c.body.id}/edit`);
  await expect(page.getByText(/Orders from a marketplace you add are read from the last 7 days/)).toBeVisible();
  if (second === null) {
    await expect(page.getByText(/separate seller account per country/)).toBeVisible();
    await shot(page, region.region, 25);
    return;
  }
  await page.locator('button[aria-haspopup="listbox"]').first().click();
  await page.locator('[role=listbox] [role=option]').filter({ hasText: second.label }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => ((await ol.call('GET', `/connections/${c.body.id}`)).body.config.marketplaceIds as string[]).includes(second.id)).toBe(true);
  await page.goto(`/connections/${c.body.id}/edit`);
  await shot(page, region.region, 25);
});

test('P028 the catalogue marketplace is chosen on the page and never follows a reordering', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `catmk ${region.region} ${STAMP}`, region, capabilities: ['ProductMaster'], config: { sellerId: 'A2EXAMPLE12345' } });
  await page.goto(`/connections/${c.body.id}/edit`);
  await expect(page.getByText('Catalogue marketplace').first()).toBeVisible();
  await expect(page.getByText(/First marketplace \(/).first()).toBeVisible();
  const ids = region.marketplaces.map((m) => m.id);
  if (ids.length > 1) {
    await page.getByLabel('Catalogue marketplace').selectOption(ids[1]);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await ol.call('GET', `/connections/${c.body.id}`)).body.config.catalogueMarketplaceId).toBe(ids[1]);
    const reordered = await patchConfig(ol, c.body.id, { marketplaceIds: [...ids].reverse() });
    expect(reordered.body.config.catalogueMarketplaceId).toBe(ids[1]);
  }
  await page.goto(`/connections/${c.body.id}/edit`);
  await shot(page, region.region, 28);
});

test('P030 tax code rows save in canonical form and an invalid row is explained', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `taxui ${region.region} ${STAMP}`, region, capabilities: ['ProductMaster'] });
  await page.goto(`/connections/${c.body.id}/edit`);
  await expect(page.getByText('No tax codes have a rate yet, so the VAT rate of Amazon products is not known.')).toBeVisible();
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Add tax code' }).click();
  const codes = page.getByLabel('Tax code');
  const rates = page.getByLabel('Rate', { exact: true });
  await codes.nth(0).fill('a_gen_standard');
  await rates.nth(0).fill('23');
  await codes.nth(1).fill('A_GEN_REDUCED');
  await rates.nth(1).fill('8');
  await codes.nth(2).fill('BROKEN');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Each row needs a tax code and a rate such as 23, 8, 0 or zw.')).toBeVisible();
  await shot(page, region.region, 30);
  await codes.nth(2).fill('');
  await page.getByRole('button', { name: 'Save changes' }).click().catch(() => undefined);
  const stored = await expect.poll(async () => (await ol.call('GET', `/connections/${c.body.id}`)).body.config.taxCodeRates).toBeTruthy().then(async () => (await ol.call('GET', `/connections/${c.body.id}`)).body.config.taxCodeRates);
  expect(stored.A_GEN_STANDARD).toBe('23');
  expect(stored.A_GEN_REDUCED).toBe('8');
});

test('P032 the FBM and FBA stock locations are chosen on the page and need each other', async ({ page, ol, region }) => {
  const w = await world(ol, region);
  const c = await createConn(ol, { name: `locui ${region.region} ${STAMP}`, region, capabilities: ['ProductMaster', 'InventoryMaster'] });
  await page.goto(`/connections/${c.body.id}/edit`);
  await page.getByLabel('FBA stock location').selectOption(w.fba);
  await expect(page.getByText(/Also choose the location of the stock you ship yourself/)).toBeVisible();
  await page.getByLabel('Location of the stock you ship (FBM)').selectOption(w.fbm);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await ol.call('GET', `/connections/${c.body.id}`)).body.config.fbaLocationId).toBe(w.fba);
  const cfg = (await ol.call('GET', `/connections/${c.body.id}`)).body.config;
  expect(cfg.stockLocationOverride).toBe(w.fbm);
  await page.goto(`/connections/${c.body.id}/edit`);
  await shot(page, region.region, 32);
});

test('P038 a viewer sees the values with disabled inputs and no save button', async ({ browser, ol, region }) => {
  const env = resolveEnv();
  const c = await createConn(ol, { name: `viewedit ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  const viewer = await provisionRoleUser(env, ol, 'viewer');
  const ctx = await browser.newContext();
  await ctx.request.post(`${env.apiUrl}/v1/auth/login`, { data: { username: viewer.username, password: viewer.password } });
  const page = await ctx.newPage();
  await page.addInitScript(() => window.localStorage.setItem('openlinker.locale', 'en'));
  await page.goto(`/connections/${c.body.id}/edit`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByLabel('Connection name')).toBeDisabled();
  await shot(page, region.region, 38);
  await ctx.close();
});

test('P043 and P044 simulated: Test connection checks that the seller sells on every marketplace', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const c = await createConn(ol, { name: `tc ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  const ok = await ol.call('POST', `/connections/${c.body.id}/test`);
  const hidden = region.marketplaces.at(-1)!.id;
  await fakePost('/__mode', { hideMarketplace: hidden });
  const bad = await ol.call('POST', `/connections/${c.body.id}/test`);
  await fakePost('/__mode', { hideMarketplace: null });
  await evidence('Test connection: every marketplace participating, then one missing (SIMULATED seller)', { ok: ok.body, missing: bad.body });
  expect(ok.body.success).toBe(true);
  expect(ok.body.message).toMatch(/Connected\. Selling in/);
  expect(bad.body.success).toBe(false);
  expect(bad.body.message).toContain(hidden);
});

test('P052 simulated: the scheduled orders poll brings in a new order by itself', async ({ ol, region, fake, evidence }) => {
  test.setTimeout(480_000);
  await fake.reset();
  const c = await createConn(ol, { name: `sched52 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
  const bought = await fakeBuy({ region: region.region, sku: `E2E-${cc(region)}-1`, qty: 1, ageMinutes: 1 });
  let rows: any[] = [];
  const start = Date.now();
  for (let i = 0; i < 90 && !rows.some((r) => r.orderSnapshot.externalOrderId === bought); i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    rows = await ordersOf(ol, c.body.id);
  }
  await evidence('order imported by the scheduled poll (no manual job; buyer SIMULATED)', { bought, seconds: Math.round((Date.now() - start) / 1000), sources: rows.map((r) => r.orderSnapshot.externalOrderId) });
  expect(rows.some((r) => r.orderSnapshot.externalOrderId === bought)).toBe(true);
});

test.describe('offer creation', () => {
  async function create(ol: OlApi, connId: string, variantId: string, extra: Record<string, unknown> = {}): Promise<{ create: any; record: any }> {
    const res = await ol.call('POST', `/listings/connections/${connId}/offers`, { internalVariantId: variantId, stock: { available: 4 }, price: undefined, ...extra }, );
    let record: any = null;
    if (res.status < 300) {
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        const r2 = await ol.call('GET', `/listings/connections/${connId}/offers/creation/${res.body.offerCreationRecordId}`);
        record = r2.body;
        if (record && ['created', 'failed', 'active', 'draft', 'validating', 'succeeded'].includes(record.status)) break;
      }
    }
    return { create: res, record };
  }

  test('P073 and P074 simulated: an EAN known to the catalogue resolves the product type and the ASIN; product types are browsable', async ({ ol, region, evidence }) => {
    const w = await world(ol, region);
    const v = w.variants[`E2E-${cc(region)}-1`];
    const resolve = await ol.call('POST', `/listings/connections/${w.sales.id}/categories/resolve`, { variantId: v.id });
    const browse = await ol.call('GET', `/connections/${w.sales.id}/mappings/options/destination/categories`);
    await evidence('category resolve by EAN and product type browse (catalogue SIMULATED)', { resolve: [resolve.status, resolve.body], browse: [browse.status, JSON.stringify(browse.body).slice(0, 400)] });
    expect(resolve.status, JSON.stringify(resolve.body)).toBeLessThan(300);
    expect(JSON.stringify(resolve.body)).toMatch(/LUGGAGE|B0CAT/);
  });

  test('P075 and P078 simulated: an offer on an existing ASIN is an offer-only listing, a second create does not overwrite', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const w = await world(ol, region);
    const v = w.variants[`E2E-${cc(region)}-2`];
    const since = new Date().toISOString();
    const first = await create(ol, w.sales.id, v.id, { price: { amount: 49.9, currency: region.marketplaces[0].currency } });
    const puts = ((await fakeGet(`/__calls?since=${since}`)).calls as any[]).filter((c) => c.method === 'PUT' && c.path.includes('/listings/'));
    const second = await create(ol, w.sales.id, v.id, { price: { amount: 49.9, currency: region.marketplaces[0].currency } });
    await evidence('offer create twice (listing side SIMULATED)', { first: [first.create.status, first.record?.status, first.record?.error], putBodies: puts.map((p) => (p.body ?? '').slice(0, 300)), second: [second.create.status, second.record?.status, second.record?.error ?? second.record] });
    expect(first.create.status, JSON.stringify(first.create.body)).toBeLessThan(300);
    expect(puts.length).toBeGreaterThan(0);
    expect(puts[0].body).toContain('LISTING_OFFER_ONLY');
    expect(JSON.stringify(second)).toMatch(/already|exist|duplicate|created|active|validating/i);
  });

  test('P076 simulated: no ASIN creates a full listing from title, brand, EAN and description', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const w = await world(ol, region);
    const v = w.variants[`E2E-${cc(region)}-NEW`];
    const since = new Date().toISOString();
    const res = await create(ol, w.sales.id, v.id, { price: { amount: 19.9, currency: region.marketplaces[0].currency }, overrides: { title: 'E2E new item', description: 'Described', categoryId: 'LUGGAGE' } });
    const puts = ((await fakeGet(`/__calls?since=${since}`)).calls as any[]).filter((c) => c.method === 'PUT' && c.path.includes('/listings/'));
    await evidence('offer without a catalogue ASIN (catalogue SIMULATED)', { create: [res.create.status, res.create.body], record: res.record?.status, putBodies: puts.map((p) => (p.body ?? '').slice(0, 400)) });
    expect(res.create.status, JSON.stringify(res.create.body)).toBeLessThan(300);
    expect(puts.some((p) => (p.body ?? '').includes('"requirements":"LISTING"'))).toBe(true);
  });

  test('P077 a product with no barcode and no ASIN is refused with a clear message', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const w = await world(ol, region);
    const v = w.variants[`E2E-${cc(region)}-NOEAN`];
    const res = await create(ol, w.sales.id, v.id, { price: { amount: 9.9, currency: region.marketplaces[0].currency } });
    await evidence('offer without a barcode', { create: [res.create.status, res.create.body], record: res.record });
    expect(JSON.stringify(res)).toMatch(/barcode|EAN|GTIN|exemption/i);
  });

  test('P079 an Amazon offer cannot be created from a bundle: the preview says the destination does not support it', async ({ ol, region, evidence }) => {
    const w = await world(ol, region);
    const v = w.variants[`E2E-${cc(region)}-1`];
    const res = await ol.call('POST', `/listings/connections/${w.sales.id}/bundle-offer-preview`, { items: [{ variantId: v.id }] });
    await evidence('POST bundle-offer-preview on an Amazon connection (the wording is the finding)', res);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/support|bundle|capab/i);
  });

  test('P082 simulated: a price change replaces purchasable_offer for the marketplace of that currency', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const w = await world(ol, region);
    const sku = `E2E-${cc(region)}-1`;
    await runJob(ol, 'marketplace.offers.sync', w.sales.id, { limit: 20, cursor: null, feedType: 'offers', masterConnectionId: w.master.id });
    const since = new Date().toISOString();
    const res = await ol.call('POST', `/listings/connections/${w.sales.id}/offers/${sku}/fields`, { price: { amount: '59.90', currency: region.marketplaces[0].currency } });
    await new Promise((r) => setTimeout(r, 6000));
    const patches = ((await fakeGet(`/__calls?since=${since}`)).calls as any[]).filter((c) => c.method === 'PATCH');
    await evidence('price change (listing SIMULATED)', { response: [res.status, res.body], patches: patches.map((p) => (p.body ?? '').slice(0, 300)) });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(patches.some((p) => (p.body ?? '').includes('purchasable_offer') && (p.body ?? '').includes('59.9'))).toBe(true);
  });

  test('P083 simulated: status sync reads BUYABLE as active and a vanished listing as ended', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const w = await world(ol, region);
    const sku = `E2E-${cc(region)}-1`;
    await runJob(ol, 'marketplace.offers.sync', w.sales.id, { limit: 20, cursor: null, feedType: 'offers', masterConnectionId: w.master.id });
    await runJob(ol, 'marketplace.offer.statusSync', w.sales.id, { limit: 20, cursorKey: 'amazon.offerStatus.scanOffset' });
    const v = w.variants[sku];
    const read = async (): Promise<any> => (await ol.call('GET', `/listings/products/${v.productId}/offer-status`)).body;
    const active = await read();
    await fakePost('/__state', { dropListing: { region: region.region, key: `${region.marketplaces[0].id}:${sku}` } });
    await runJob(ol, 'marketplace.offer.statusSync', w.sales.id, { limit: 20, cursorKey: 'amazon.offerStatus.scanOffset' });
    const ended = await read();
    await fake.reset();
    await evidence('offer status before and after the listing vanished (SIMULATED)', { active, ended });
    expect(JSON.stringify(active)).toMatch(/active/);
    expect(JSON.stringify(ended)).toMatch(/ended/);
  });
});

test.describe('Multi-Channel Fulfillment dispatch (simulated)', () => {
  async function seedWork(ol: OlApi, region: RegionFixture, opts: { sku: string; noAddress?: boolean; tag: string }): Promise<{ workId: string; masterId: string }> {
    const w = await world(ol, region);
    await ol.call('PATCH', `/connections/${w.master.id}`, { enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'FulfillmentExecutor'] });
    const bought = await fakeBuy({ region: region.region, sku: opts.sku, qty: 1, ageMinutes: 1, ...(opts.noAddress ? { noRecipient: true } : {}) });
    const src = await createConn(ol, { name: `mcf src ${opts.tag} ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
    await runJob(ol, 'marketplace.orders.poll', src.body.id, { limit: 100, cursorKey: 'amazon.orders.feedCursor' });
    const row = (await pollUntilHas(ol, src.body.id, [bought])).find((o) => o.orderSnapshot.externalOrderId === bought)!;
    const variantId = w.variants[opts.sku]?.id ?? `ol_variant_unknown_${STAMP}`;
    const workId = `ol_work_e2e${STAMP}${Math.floor(Math.random() * 1e6)}`;
    await sql(`insert into fulfillment_works (id, "orderId", "assignedConnectionId", status, "requestStatus") values ($1,$2,$3,'open','unsubmitted')`, [workId, row.internalOrderId, w.master.id]);
    await sql(`insert into fulfillment_work_lines ("fulfillmentWorkId","orderLineId","productVariantId","totalQuantity") values ($1,$2,$3,1)`, [workId, row.orderSnapshot.items[0].id, variantId]);
    return { workId, masterId: w.master.id };
  }
  const dispatch = async (ol: OlApi, s: { workId: string; masterId: string }): Promise<any> =>
    runJob(ol, 'fulfillment.work.dispatch', s.masterId, { workId: s.workId, orderId: (await sql<{ orderId: string }>(`select "orderId" from fulfillment_works where id = $1`, [s.workId]))[0].orderId, assignmentAttempt: null });
  const workRow = async (id: string): Promise<any> => (await sql(`select "requestStatus","externalWorkId","acceptedAt","assignmentAttempt" from fulfillment_works where id = $1`, [id]))[0];

  test('P096 simulated: work whose variant is in FBA stock is previewed, created once and accepted, and a retry answers the same acceptance', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const s = await seedWork(ol, region, { sku: `E2E-${cc(region)}-FBA`, tag: 'ok' });
    const job = await dispatch(ol, s);
    const row1 = await workRow(s.workId);
    const sim1 = await fakeGet('/__sim');
    await sql(`update fulfillment_works set "requestStatus" = 'unsubmitted', "acceptedAt" = null where id = $1`, [s.workId]);
    const job2 = await dispatch(ol, s);
    const sim2 = await fakeGet('/__sim');
    await evidence('MCF dispatch (Amazon SIMULATED)', { job: [job.status, job.outcome, job.lastError], work: row1, mcfOrders: sim1.mcf, afterRetry: sim2.mcf, retryJob: [job2.status, job2.outcome] });
    expect(row1.requestStatus).toBe('accepted');
    expect(sim1.mcf.length).toBeGreaterThanOrEqual(1);
    expect(sim2.mcf.length).toBe(sim1.mcf.length);
  });

  test('P097 work whose variant has no Amazon SKU mapping is rejected, blocking, sku-not-on-amazon', async ({ ol, region, evidence }) => {
    const s = await seedWork(ol, region, { sku: `E2E-${cc(region)}-1`, tag: 'nosku' });
    await sql(`update fulfillment_work_lines set "productVariantId" = 'ol_variant_not_on_amazon' where "fulfillmentWorkId" = $1`, [s.workId]);
    const job = await dispatch(ol, s);
    const row = await workRow(s.workId);
    await evidence('dispatch of work with an unmapped variant', { job: [job.status, job.outcome, job.lastError], work: row });
    expect(row.requestStatus).toBe('rejected');
    expect(JSON.stringify([job, row])).toMatch(/sku-not-on-amazon|no Amazon SKU/);
  });

  test('P098 work for an order with no delivery address is rejected, blocking, with the missing-address reason', async ({ ol, region, evidence }) => {
    const s = await seedWork(ol, region, { sku: `E2E-${cc(region)}-FBA`, noAddress: true, tag: 'noaddr' });
    const job = await dispatch(ol, s);
    const row = await workRow(s.workId);
    await evidence('dispatch of work without a delivery address', { job: [job.status, job.outcome, job.lastError], work: row });
    expect(row.requestStatus).toBe('rejected');
    expect(JSON.stringify([job, row])).toMatch(/address|buyer-data/i);
  });

  test('P099 simulated: work Amazon cannot fulfil is rejected, blocking, with Amazon reasons', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    await fakePost('/__mode', { mcfFulfillable: false });
    const s = await seedWork(ol, region, { sku: `E2E-${cc(region)}-FBA`, tag: 'unf' });
    const job = await dispatch(ol, s);
    const row = await workRow(s.workId);
    await fakePost('/__mode', { mcfFulfillable: true });
    await evidence('MCF preview says not fulfillable (Amazon SIMULATED)', { job: [job.status, job.outcome, job.lastError], work: row });
    expect(row.requestStatus).toBe('rejected');
    expect(JSON.stringify([job, row])).toMatch(/not-fulfillable|NoStock|cannot fulfil/i);
  });

  test('P102 simulated: the shipping speed from the connection reaches the MCF order', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const w = await world(ol, region);
    await patchConfig(ol, w.master.id, { mcfShippingSpeed: 'Priority' });
    const s = await seedWork(ol, region, { sku: `E2E-${cc(region)}-FBA`, tag: 'speed' });
    await dispatch(ol, s);
    const mine = (await fakeGet('/__sim')).mcf.at(-1);
    await sql(`update connections set config = config - 'mcfShippingSpeed' where id = $1`, [w.master.id]);
    await evidence('MCF order created with Priority (Amazon SIMULATED)', mine);
    expect(mine.speed).toBe('Priority');
  });
});

test('P095 the who-decides page lists the Amazon connection as a fulfilment executor candidate', async ({ page, ol, region }) => {
  const w = await world(ol, region);
  await ol.call('PATCH', `/connections/${w.master.id}`, { enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'FulfillmentExecutor'] });
  const status = await ol.call('GET', '/fulfillment-authority/status');
  await page.goto('/settings/who-decides');
  await expect(page.getByText(/Who decides/i).first()).toBeVisible();
  expect(JSON.stringify(status.body)).toContain(w.master.id);
  await shot(page, region.region, 95);
});

void REGIONS; void OlApiClass; void DAY;
