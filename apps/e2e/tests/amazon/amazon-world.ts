/**
 * Shared Amazon test world: a catalogue-master connection that reads the
 * seller's listings from the fake and a sales connection linked to it.
 *
 * @module tests/amazon
 */
import { createConn, runJob, type OlApi } from './amazon-test';
import type { RegionFixture } from '../../src/support/amazon';

const SELLER = 'A2EXAMPLE12345';
const cc = (r: RegionFixture): string => r.marketplaces[0].country;

export interface World {
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
  const hit = items.find((l) => l.code === code.toUpperCase());
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
    const prods = (await ol.call('GET', '/products?limit=100')).body;
    const items = (prods?.items ?? prods) as { id: string; name: string; sku?: string }[];
    const mine = items.filter((p) => String(p.name).includes(`E2E-${cc(region)}-`));
    if (mine.length >= 6) {
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

