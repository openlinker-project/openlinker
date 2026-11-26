/**
 * Amazon E2E part B.7-B.8 - offers, catalogue master and FBA inventory
 * (points 70-94). The master connection reads the seller's listings from the
 * fake; the sales connection links its offers to those products by SKU.
 *
 * @module tests/amazon
 */
import { test, expect, shot, createConn, patchConfig, runJob, listJobs, sql, fakeGet, fakePost, type OlApi } from './amazon-test';
import type { RegionFixture } from '../../src/support/amazon';

const SELLER = 'A2EXAMPLE12345';
const cc = (r: RegionFixture): string => r.marketplaces[0]!.country;

interface World {
  master: { id: string };
  sales: { id: string };
  fbm: string;
  fba: string;
  variants: Record<string, { id: string; productId: string }>;
}

const worlds = new Map<string, World>();

async function ensureConn(ol: OlApi, name: string, make: () => Promise<{ status: number; body: any }>): Promise<{ id: string }> {
  const list = (await ol.call('GET', '/connections')).body as { id: string; name: string }[];
  const hit = list.find((c) => c.name === name);
  if (hit) return hit;
  const res = await make();
  if (res.status !== 201) throw new Error(`create ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function ensureLocation(ol: OlApi, code: string): Promise<string> {
  const list = await ol.call('GET', '/inventory/locations');
  const items = (list.body?.items ?? list.body) as { id: string; code: string }[];
  const hit = items.find((l) => l.code === code);
  if (hit) return hit.id;
  const res = await ol.call('POST', '/inventory/locations', { code, name: code, kind: 'warehouse' });
  if (res.status >= 300) throw new Error(`location ${code}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

export async function world(ol: OlApi, region: RegionFixture): Promise<World> {
  const cached = worlds.get(region.region);
  if (cached) return cached;
  const fbm = await ensureLocation(ol, `E2E-${region.region}-FBM`);
  const fba = await ensureLocation(ol, `E2E-${region.region}-FBA`);
  const master = await ensureConn(ol, `E2E master ${region.region}`, () =>
    createConn(ol, { name: `E2E master ${region.region}`, region, capabilities: ['ProductMaster', 'InventoryMaster'], config: { sellerId: SELLER, stockLocationOverride: fbm } }),
  );
  const sales = await ensureConn(ol, `E2E sales ${region.region}`, () =>
    createConn(ol, { name: `E2E sales ${region.region}`, region, capabilities: ['OrderSource', 'OfferManager'], config: { sellerId: SELLER, masterCatalogConnectionId: master.id } }),
  );
  await runJob(ol, 'master.product.syncAll', master.id, {});
  const variants: World['variants'] = {};
  for (let i = 0; i < 20; i += 1) {
    const prods = (await ol.call('GET', '/products?limit=200')).body;
    const items = (prods?.items ?? prods) as { id: string; name: string; sku?: string }[];
    const mine = items.filter((p) => String(p.name).includes(`E2E-${cc(region)}-`));
    if (mine.length >= 3) {
      for (const p of mine) {
        const vs = ((await ol.call('GET', `/products/${p.id}/variants`)).body?.items ?? (await ol.call('GET', `/products/${p.id}/variants`)).body) as { id: string; sku?: string }[];
        for (const v of vs) if (v.sku) variants[v.sku] = { id: v.id, productId: p.id };
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const w = { master, sales, fbm, fba, variants };
  worlds.set(region.region, w);
  return w;
}

test('P085 the product sweep creates products with the SKU as external id', async ({ ol, region, evidence }) => {
  const w = await world(ol, region);
  await evidence('variants by SKU after master.product.syncAll', w.variants);
  for (const n of [1, 2]) expect(w.variants[`E2E-${cc(region)}-${n}`]).toBeTruthy();
  expect(w.variants[`E2E-${cc(region)}-FBA`]).toBeTruthy();
});

const callsOf = async (path: string, method?: string): Promise<any[]> => {
  const all = (await fakeGet('/__calls?path=' + encodeURIComponent(path))).calls as any[];
  return method ? all.filter((c) => c.method === method) : all;
};

test('P086 an Amazon-sourced product shows its listing content and a gross price', async ({ page, ol, region }) => {
  const w = await world(ol, region);
  const v = w.variants[`E2E-${cc(region)}-1`]!;
  await page.goto(`/products/${v.productId}`);
  await expect(page.getByText(new RegExp(`Listing E2E-${cc(region)}-1`)).first()).toBeVisible();
  const detail = (await ol.call('GET', `/products/${v.productId}`)).body;
  expect(JSON.stringify(detail)).toMatch(new RegExp(region.marketplaces[0]!.currency));
  await shot(page, region.region, 86);
});

test('P087 offers and inventory master cannot both be enabled on one connection', async ({ ol, region, evidence }) => {
  const c = await createConn(ol, { name: `both ${region.region} ${Date.now()}`, region, capabilities: ['OrderSource'], config: { sellerId: SELLER } });
  const res = await ol.call('PATCH', `/connections/${c.body.id}`, { enabledCapabilities: ['OfferManager', 'InventoryMaster'] });
  await evidence('PATCH enabledCapabilities OfferManager + InventoryMaster', res);
  expect(res.status).toBe(400);
});

test('P088 the inventory sweep with a stock location reads FBM only', async ({ ol, region, fake, evidence }) => {
  const w = await world(ol, region);
  await fake.clearFailures();
  const since = new Date().toISOString();
  const job = await runJob(ol, 'master.inventory.syncAll', w.master.id, {});
  await new Promise((r) => setTimeout(r, 8000));
  const fbaCalls = ((await fakeGet(`/__calls?path=/fba/inventory/v1/summaries&since=${since}`)).calls as any[]).length;
  const rows = await sql<{ locationId: string; availableQuantity: number; productVariantId: string }>(`select "locationId","availableQuantity","productVariantId" from inventory_items where "sourceConnectionId" = $1 or "sourceConnectionId" is null`, [w.master.id]);
  await evidence('master.inventory.syncAll without fbaLocationId', { job: job.outcome, fbaSummaryCalls: fbaCalls, positions: rows.length, locations: [...new Set(rows.map((r) => r.locationId))] });
  expect(job.status).toBe('succeeded');
  expect(fbaCalls).toBe(0);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.locationId === w.fbm)).toBe(true);
});

test('P089 with an FBA location FBA stock appears as available and reserved there', async ({ ol, region, evidence }) => {
  const w = await world(ol, region);
  const patched = await patchConfig(ol, w.master.id, { fbaLocationId: w.fba });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  await runJob(ol, 'master.inventory.syncAll', w.master.id, {});
  await new Promise((r) => setTimeout(r, 10000));
  const fbaVariant = w.variants[`E2E-${cc(region)}-FBA`]!;
  const rows = await sql<{ locationId: string; availableQuantity: number; reservedQuantity: number; productVariantId: string }>(`select "locationId","availableQuantity","reservedQuantity","productVariantId" from inventory_items where "locationId" = $1`, [w.fba]);
  await evidence('positions at the FBA location', rows);
  const own = rows.find((r) => r.productVariantId === fbaVariant.id)!;
  expect(own.availableQuantity).toBe(12);
  expect(own.reservedQuantity).toBe(3);
  const others = rows.filter((r) => r.productVariantId !== fbaVariant.id);
  expect(others.length).toBeGreaterThan(0);
  for (const o of others) expect(o.availableQuantity).toBe(0);
});

test('P090 an FBA location without an FBM override reports no FBA stock and keeps FBM', async ({ ol, region, evidence }) => {
  const w = await world(ol, region);
  await sql(`update connections set config = config - 'stockLocationOverride' where id = $1`, [w.master.id]);
  const before = (await sql<{ n: string }>(`select count(*)::text n from inventory_items where "locationId" = $1 and "isStale" = false`, [w.fbm]))[0]!.n;
  const since = new Date().toISOString();
  await runJob(ol, 'master.inventory.syncAll', w.master.id, {});
  await new Promise((r) => setTimeout(r, 8000));
  const fbaCalls = ((await fakeGet(`/__calls?path=/fba/inventory/v1/summaries&since=${since}`)).calls as any[]).length;
  const after = (await sql<{ n: string }>(`select count(*)::text n from inventory_items where "locationId" = $1 and "isStale" = false`, [w.fbm]))[0]!.n;
  await evidence('FBA location set, FBM override removed in the DB', { fbaSummaryCalls: fbaCalls, fbmLiveBefore: before, fbmLiveAfter: after });
  expect(fbaCalls).toBe(0);
  expect(after).toBe(before);
  await sql(`update connections set config = jsonb_set(config, '{stockLocationOverride}', to_jsonb($2::text)) where id = $1`, [w.master.id, w.fbm]);
});
});
