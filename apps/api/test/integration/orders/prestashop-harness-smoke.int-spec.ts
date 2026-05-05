/**
 * PrestaShop Testcontainer Harness — Smoke (#506 Phase 1)
 *
 * Proves the new PS Testcontainer helper + fixture work end-to-end:
 *
 *   1. Boots PS + MySQL via `startPrestashopContainer`.
 *   2. Hits `/api/carriers` directly (Basic auth, JSON output) with the
 *      seeded WS API key — keeps this smoke check independent of the
 *      package's internal HTTP client.
 *   3. Asserts the OpenLinker Dynamic carrier row (the one that satisfies
 *      `discoverDynamicCarrierId()` in the production order-processor adapter)
 *      is present, active, and externally tagged.
 *
 * Phase 2 (separate issue) layers the full
 * `OrderIngestionService.syncOrderFromSource` exercise on top of this same
 * harness — see `docs/plans/implementation-plan-506-carrier-mapping-int-spec.md`
 * for the phasing rationale.
 *
 * Suite-scoped: PS container starts in `beforeAll` and stops in `afterAll`,
 * because the boot is heavy (~60-90s warm cache, 5-10 min cold-cache CI). NOT
 * wired into the global Postgres+Redis harness so other int-specs continue to
 * run on the fast (~10-15s) baseline.
 *
 * @module apps/api/test/integration/orders
 */
import {
  PrestashopTestContainer,
  startPrestashopContainer,
} from '../helpers/prestashop-container.helper';

interface PrestashopCarrierRow {
  id: string | number;
  active: string | number;
  deleted: string | number;
  external_module_name?: string;
}

async function listCarriersRaw(
  baseUrl: string,
  apiKey: string,
  filterExternalModuleName?: string,
): Promise<PrestashopCarrierRow[]> {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/carriers`);
  url.searchParams.set('display', 'full');
  url.searchParams.set('output_format', 'JSON');
  if (filterExternalModuleName) {
    url.searchParams.set('filter[external_module_name]', filterExternalModuleName);
  }

  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `PS WS GET /api/carriers failed: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`,
    );
  }
  const data = (await response.json()) as { carriers?: PrestashopCarrierRow[] };
  return Array.isArray(data.carriers) ? data.carriers : [];
}

describe('PrestaShop Testcontainer harness (#506 Phase 1)', () => {
  let container: PrestashopTestContainer;

  beforeAll(async () => {
    container = await startPrestashopContainer();
    // Long boot — Jest's per-test timeout would cut us off on cold-cache runs.
  }, 15 * 60_000);

  afterAll(async () => {
    if (container) {
      await container.cleanup();
    }
  });

  it('seeds a usable WS API key (carriers endpoint responds)', async () => {
    const rows = await listCarriersRaw(container.baseUrl, container.webserviceApiKey);
    // PS install seeds a handful of default carriers (≥1). Exact count varies
    // between PS versions, so just assert the WS path is wired.
    expect(rows.length).toBeGreaterThan(0);
  });

  it('seeds the OpenLinker Dynamic carrier row that discoverDynamicCarrierId() relies on', async () => {
    const rows = await listCarriersRaw(
      container.baseUrl,
      container.webserviceApiKey,
      'openlinker',
    );
    const live = rows.filter(
      (r) => Number(r.active) === 1 && Number(r.deleted) === 0,
    );

    expect(live.length).toBeGreaterThanOrEqual(1);
    expect(Number(live[0].id)).toBe(container.olDynamicCarrierId);
    // Same predicate the production adapter applies — keep this assertion
    // tight so a fixture drift surfaces here, not in Phase 2's order-create.
    expect(live[0].external_module_name).toBe('openlinker');
  });
});
