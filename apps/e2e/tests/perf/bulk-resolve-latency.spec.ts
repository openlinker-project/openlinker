/**
 * Bulk-offer wizard - Resolve-step latency and progress measurement
 *
 * Answers a concrete operator complaint: selecting several products in the
 * unified publish flow and continuing past Configure leaves the wizard sitting
 * on "Resolving" for a long time with a counter that does not move, and
 * sometimes ends in an error.
 *
 * This is a MEASUREMENT spec, not a pass/fail feature test. It drives the real
 * wizard (real chunking, real react-query retry policy, real request timeout)
 * against a stubbed OL API whose `categories/resolve-batch` response time is
 * derived from the SAME cost model the production backend has:
 *
 *   backend wall time = ceil(items / ALLEGRO_EAN_CONCURRENCY) * perEanLatencyMs
 *
 * because `resolveCategoriesForBatchByEan`
 * (`libs/integrations/allegro/src/infrastructure/util/`) issues exactly one
 * `GET /sale/products?phrase={ean}&mode=GTIN` per item - Allegro exposes no
 * bulk GTIN lookup - with a fixed in-flight cap of 3. That model was verified
 * against the real util with a latency-injecting fake HTTP client: wall time is
 * `ceil(n/3) * latency` to within 1%, max in-flight 3, one HTTP call per item.
 *
 * Stubbing the transport (rather than pointing at a live Allegro sandbox) is
 * what makes the numbers reproducible and lets the per-EAN latency be swept.
 * Everything above the transport - the 50-item chunking, `useQueries` fan-out,
 * the 30 s `AbortController` in `api-client.ts`, `shouldRetryTransient`, and the
 * progress copy the operator reads - is the app's own production code.
 *
 * Needs a running API (for the session) and a running web app; no Allegro
 * connection and no seeded catalogue, so it is safe on any stack.
 *
 * @module tests/perf
 */
import { test, expect } from '../../src/fixtures/test';
import type { Page, Route } from '@playwright/test';

/** FE chunk size - mirrors `RESOLVE_CHUNK_SIZE` in `bulk-resolve-step.tsx`. */
const FE_RESOLVE_CHUNK_SIZE = 50;
/** Backend in-flight cap - mirrors `DEFAULT_CONCURRENCY` in `resolve-categories-for-batch-by-ean.ts`. */
const ALLEGRO_EAN_CONCURRENCY = 3;
/** Browser request timeout - mirrors `DEFAULT_TIMEOUT_MS` in `apps/web/src/app/api/api-client.ts`. */
const CLIENT_TIMEOUT_MS = 30_000;

const CONNECTION_ID = '00000000-0000-4000-8000-00000000perf'.replace('perf', '0001');
const MASTER_CONNECTION_ID = '00000000-0000-4000-8000-000000000002';
const DELIVERY_POLICY_ID = 'perf-delivery-policy';
const RESOLVED_CATEGORY_ID = '165986';

interface SyntheticVariant {
  id: string;
  productId: string;
  sku: string;
  ean: string;
  price: number;
}

interface SyntheticProduct {
  id: string;
  name: string;
  sku: string;
  variants: SyntheticVariant[];
}

/**
 * Builds a catalogue whose shape matters for the fan-out: the Resolve step
 * expands EVERY sibling variant of every selected product (#1741), so what
 * drives cost is total variants carrying an EAN, not product count.
 */
function buildCatalogue(productCount: number, variantsPerProduct: number): SyntheticProduct[] {
  const products: SyntheticProduct[] = [];
  let eanSeq = 0;
  for (let p = 0; p < productCount; p++) {
    const productId = `ol_product_perf${String(p).padStart(4, '0')}`;
    const variants: SyntheticVariant[] = [];
    for (let v = 0; v < variantsPerProduct; v++) {
      variants.push({
        id: `ol_variant_perf${String(p).padStart(4, '0')}_${v}`,
        productId,
        sku: `PERF-${p}-${v}`,
        // Valid EAN-13 check digit is not required: the wizard only gates on
        // `isValidGtin` for its own blocker set, and a 13-digit numeric code
        // passes. The resolve simulator answers `matched` regardless.
        ean: buildEan13(5900000000000 + eanSeq++),
        price: 49.9,
      });
    }
    products.push({
      id: productId,
      name: `Perf product ${p} (${variantsPerProduct} variants)`,
      sku: `PERF-${p}`,
      variants,
    });
  }
  return products;
}

/** 12 digits + GS1 mod-10 check digit, so the wizard's GTIN gate passes. */
function buildEan13(seed: number): string {
  const base = String(seed).slice(0, 12).padStart(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return base + String((10 - (sum % 10)) % 10);
}

interface ResolveCall {
  index: number;
  items: number;
  startedAt: number;
  simulatedMs: number;
  endedAt: number | null;
}

interface Measurement {
  scenario: string;
  variants: number;
  perEanLatencyMs: number;
  expectedChunks: number;
  resolveCalls: ResolveCall[];
  /**
   * Attempts the browser abandoned at its 30 s `AbortController` deadline. The
   * backend has no idea: NestJS keeps running the whole fan-out, so this work is
   * spent on the marketplace API either way.
   */
  abortedAttempts: number;
  availabilityCalls: number;
  progressStates: ProgressState[];
  /**
   * Wizard entry cost, measured separately: the page hydrates every selected
   * product with ONE `GET /products/{id}` each (`useProductsBatchQuery`), so a
   * 40-product batch is 40 requests before Configure can even render.
   */
  configReadyMs: number;
  productDetailRequests: number;
  totalMs: number;
  outcome: 'review' | 'error';
}

/**
 * Installs the whole API surface the wizard touches on the marketplace path.
 * Only `resolve-batch` is latency-bearing; every other route answers instantly
 * so the measurement isolates the resolve fan-out.
 */
async function stubWizardApi(
  page: Page,
  catalogue: SyntheticProduct[],
  perEanLatencyMs: number,
  calls: ResolveCall[],
  availability: { count: number },
): Promise<void> {
  const byId = new Map(catalogue.map((p) => [p.id, p]));
  const now = new Date().toISOString();

  const json = (route: Route, body: unknown): Promise<void> =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  await page.route('**/v1/connections', (route) =>
    json(route, [
      {
        id: CONNECTION_ID,
        name: 'Allegro (perf harness)',
        platformType: 'allegro',
        status: 'active',
        // The Configure step blocks unless a master catalogue is set (#1934/F4).
        config: { masterCatalogConnectionId: MASTER_CONNECTION_ID },
        credentialsBacked: true,
        adapterKey: 'allegro.publicapi.v1',
        enabledCapabilities: ['OfferManager'],
        supportedCapabilities: ['OfferManager', 'OfferCreator', 'CategoryBrowser', 'EanCategoryMatcher'],
        variantGrouping: 'catalog-implicit',
        defaultRateLimit: null,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );

  await page.route('**/v1/products/ol_product_perf*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    const product = byId.get(id);
    if (!product) return route.fulfill({ status: 404, body: '{}' });
    return json(route, {
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: 49.9,
      currency: 'PLN',
      description: 'Perf harness product.',
      images: ['https://example.invalid/img.jpg'],
      // A source category is what makes a no-EAN row still reach the backend's
      // configured-mapping fallback (#1522) - kept populated so the request
      // body matches what a mapped catalogue really sends.
      categories: ['10'],
      features: [],
      createdAt: now,
      updatedAt: now,
      variantCount: product.variants.length,
      variants: product.variants.map((v) => ({
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        attributes: { Size: v.sku.slice(-1) },
        ean: v.ean,
        gtin: null,
        price: v.price,
        createdAt: now,
        updatedAt: now,
      })),
      externalIds: [],
    });
  });

  await page.route('**/v1/listings/connections/*/seller-policies', (route) =>
    json(route, {
      deliveryPolicies: [{ id: DELIVERY_POLICY_ID, name: 'Perf delivery package' }],
      returnPolicies: [{ id: 'perf-return', name: 'Perf returns' }],
      warranties: [],
      impliedWarranties: [],
    }),
  );

  await page.route('**/v1/listings/connections/*/responsible-producers', (route) =>
    json(route, { producers: [] }),
  );
  await page.route('**/v1/listings/connections/*/delivery-price-lists', (route) =>
    json(route, { priceLists: [] }),
  );
  await page.route('**/v1/listings/published-variants', (route) =>
    json(route, { publishedVariantIds: [] }),
  );
  await page.route('**/v1/listings/connections/*/categories/*/parameters', (route) =>
    json(route, { parameters: [] }),
  );
  await page.route('**/v1/listings/connections/*/categories/*/path', (route) =>
    json(route, { path: [{ id: RESOLVED_CATEGORY_ID, name: 'Perf category' }] }),
  );

  await page.route('**/v1/inventory/availability*', (route) => {
    availability.count += 1;
    const ids = (new URL(route.request().url()).searchParams.get('productVariantIds') ?? '')
      .split(',')
      .filter((s) => s.length > 0);
    return json(route, {
      items: ids.map((id) => ({ productVariantId: id, totalAvailable: 12, locationCount: 1 })),
    });
  });

  await page.route('**/v1/listings/connections/*/categories/resolve-batch', async (route) => {
    const body = route.request().postDataJSON() as {
      items: { variantId: string; ean: string | null }[];
    };
    const call: ResolveCall = {
      index: calls.length,
      items: body.items.length,
      startedAt: Date.now(),
      simulatedMs: Math.ceil(body.items.length / ALLEGRO_EAN_CONCURRENCY) * perEanLatencyMs,
      endedAt: null,
    };
    calls.push(call);
    await new Promise((resolve) => setTimeout(resolve, call.simulatedMs));
    const results: Record<string, unknown> = {};
    for (const item of body.items) {
      results[item.variantId] = {
        kind: 'matched',
        allegroCategoryId: RESOLVED_CATEGORY_ID,
        productCardId: `card-${item.variantId}`,
        method: 'auto_detect',
      };
    }
    // A `fulfill` after the browser already aborted resolves quietly, so the
    // abort is counted from the page's own `requestfailed` events instead.
    await json(route, { results }).catch(() => undefined);
    call.endedAt = Date.now();
  });
}

/**
 * A distinct progress string the operator saw, and for how long it stood.
 * `heldMs` is the measurement that matters: it is how long the wizard showed
 * one unchanging line while work was in flight.
 */
interface ProgressState {
  text: string;
  firstAtMs: number;
  lastAtMs: number;
  heldMs: number;
}

/** Samples the Resolve step's own progress copy so a frozen counter is measurable. */
function startProgressSampling(
  page: Page,
  start: number,
  states: ProgressState[],
): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    while (!stopped) {
      const raw = await page
        .locator('[role="status"] h2')
        .first()
        .textContent()
        .catch(() => null);
      if (raw !== null) {
        const text = raw.trim();
        const atMs = Date.now() - start;
        const last = states[states.length - 1];
        if (last && last.text === text) {
          last.lastAtMs = atMs;
          last.heldMs = atMs - last.firstAtMs;
        } else {
          states.push({ text, firstAtMs: atMs, lastAtMs: atMs, heldMs: 0 });
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  void tick();
  return () => {
    stopped = true;
  };
}

interface Scenario {
  name: string;
  products: number;
  variantsPerProduct: number;
  perEanLatencyMs: number;
}

/**
 * Latencies are the ones that matter, not a smooth sweep: 200 ms is a healthy
 * Allegro `/sale/products` response, 600 ms a typical loaded one, and 1 900 ms
 * the point where a single full 50-item chunk crosses the browser's 30 s
 * timeout (ceil(50/3) * 1 900 = 32 300 ms).
 */
const SCENARIOS: Scenario[] = [
  { name: 'small batch, healthy latency', products: 6, variantsPerProduct: 2, perEanLatencyMs: 200 },
  { name: 'medium batch, typical latency', products: 15, variantsPerProduct: 3, perEanLatencyMs: 600 },
  { name: 'large batch, typical latency', products: 40, variantsPerProduct: 3, perEanLatencyMs: 600 },
  { name: 'one chunk over the client timeout', products: 25, variantsPerProduct: 2, perEanLatencyMs: 1_900 },
];

for (const scenario of SCENARIOS) {
  test(`resolve step: ${scenario.name}`, async ({ page }, testInfo) => {
    const catalogue = buildCatalogue(scenario.products, scenario.variantsPerProduct);
    const variants = scenario.products * scenario.variantsPerProduct;
    const expectedChunks = Math.ceil(variants / FE_RESOLVE_CHUNK_SIZE);
    const calls: ResolveCall[] = [];
    const availability = { count: 0 };
    let abortedAttempts = 0;
    page.on('requestfailed', (request) => {
      if (request.url().includes('/categories/resolve-batch')) abortedAttempts += 1;
    });

    await stubWizardApi(page, catalogue, scenario.perEanLatencyMs, calls, availability);

    let productDetailRequests = 0;
    page.on('request', (request) => {
      if (/\/v1\/products\/ol_product_perf/.test(request.url())) productDetailRequests += 1;
    });

    const productIds = catalogue.map((p) => p.id).join(',');
    const entryStart = Date.now();
    await page.goto(
      `/listings/bulk-create/wizard?productIds=${productIds}&connectionId=${CONNECTION_ID}`,
    );

    // Configure step: the Allegro contribution gates Proceed on a delivery policy.
    await expect(page.getByRole('heading', { name: 'Configure batch' })).toBeVisible({
      timeout: 30_000,
    });
    const configReadyMs = Date.now() - entryStart;
    await page.getByLabel('Shipping rate package').selectOption(DELIVERY_POLICY_ID);

    const start = Date.now();
    const progressStates: ProgressState[] = [];
    const stopSampling = startProgressSampling(page, start, progressStates);

    await page.getByRole('button', { name: /Proceed|Continue|Next/i }).first().click();

    // Race the two terminal states rather than waiting out the happy path first:
    // the failing scenario reaches its error alert long before any review
    // heading would appear, and the measurement wants the moment the operator
    // actually learns something, not a test timeout.
    const outcome = await Promise.race([
      page
        .getByRole('heading', { name: /^Review \d+ products?$/ })
        .waitFor({ state: 'visible', timeout: 300_000 })
        .then((): 'review' => 'review'),
      page
        .getByText('Could not resolve categories and stock for this batch.')
        .waitFor({ state: 'visible', timeout: 300_000 })
        .then((): 'error' => 'error'),
    ]);
    const totalMs = Date.now() - start;
    stopSampling();

    const measurement: Measurement = {
      scenario: scenario.name,
      variants,
      perEanLatencyMs: scenario.perEanLatencyMs,
      expectedChunks,
      resolveCalls: calls,
      abortedAttempts,
      availabilityCalls: availability.count,
      progressStates,
      configReadyMs,
      productDetailRequests,
      totalMs,
      outcome,
    };
    await testInfo.attach('resolve-measurement.json', {
      body: JSON.stringify(measurement, null, 2),
      contentType: 'application/json',
    });

    const longestFreeze = progressStates.reduce((max, p) => Math.max(max, p.heldMs), 0);
    // eslint-disable-next-line no-console -- measurement output is the point of this spec
    console.log(
      [
        `[resolve-perf] ${scenario.name}`,
        `variants=${variants}`,
        `perEan=${scenario.perEanLatencyMs}ms`,
        `configReady=${(configReadyMs / 1000).toFixed(1)}s(${productDetailRequests} product GETs)`,
        `chunks=${expectedChunks}`,
        `resolveRequests=${calls.length}`,
        `aborted=${abortedAttempts}`,
        `total=${(totalMs / 1000).toFixed(1)}s`,
        `longestFrozenCounter=${(longestFreeze / 1000).toFixed(1)}s`,
        `outcome=${outcome}`,
        `progress=${progressStates
          .map((p) => `"${p.text}" held ${(p.heldMs / 1000).toFixed(1)}s`)
          .join(' -> ')}`,
      ].join(' '),
    );

    // Invariants, not wall-clock assertions (which would be flaky).
    // Availability is chunked on the same 50-id boundary and answers instantly.
    expect(availability.count).toBe(expectedChunks);
    // One product-detail request per selected product - there is no batch read.
    expect(productDetailRequests).toBe(scenario.products);
    if (abortedAttempts === 0) {
      // One marketplace-bearing request per 50-variant chunk. No batching, no
      // resumption: the chunk is the unit of both work and failure.
      expect(calls.length).toBe(expectedChunks);
      expect(outcome).toBe('review');
    } else {
      // Each abort is retried by `shouldRetryTransient` (a client timeout
      // surfaces as `status: 0`, which `isNetworkError()` reports as transient),
      // and every retry re-runs the WHOLE chunk on the backend.
      expect(calls.length).toBeGreaterThan(expectedChunks);
      // The operator watches an unchanging counter for the entire amplified
      // sequence before any error is shown.
      expect(longestFreeze).toBeGreaterThan(CLIENT_TIMEOUT_MS * 2);
    }
  });
}
