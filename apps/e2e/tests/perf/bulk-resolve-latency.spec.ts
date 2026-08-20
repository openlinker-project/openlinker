/**
 * Bulk-offer wizard - Resolve-step latency, streamed progress, and regression guard
 *
 * Answers a concrete operator complaint: selecting several products in the
 * unified publish flow and continuing past Configure left the wizard sitting on
 * "Resolving" for a long time with a counter that did not move, and sometimes
 * ended in an error. This file produced the numbers epic #2205 was opened on,
 * and #2212 turns it into that epic's regression guard.
 *
 * It drives the real wizard (real chunking, real react-query retry policy, real
 * blocker computation) against a stubbed OL API. Only the resolve transport
 * carries latency, and it is derived from the SAME cost model the production
 * backend has:
 *
 *   backend wall time = ceil(items / ALLEGRO_EAN_CONCURRENCY) * perEanLatencyMs
 *
 * because `resolveCategoriesForBatchByEan`
 * (`libs/integrations/allegro/src/infrastructure/util/`) issues exactly one
 * `GET /sale/products?phrase={ean}&mode=GTIN` per item - Allegro exposes no
 * bulk GTIN lookup - with a fixed in-flight cap of 3. That model was verified
 * against the real util with a latency-injecting fake HTTP client: wall time is
 * `ceil(n/3) * latency` to within 1%, max in-flight 3, one HTTP call per item.
 * Streamed, the same model paces one NDJSON line every `perEanLatencyMs / 3`.
 *
 * Stubbing the transport (rather than pointing at a live Allegro sandbox) is
 * what makes the numbers reproducible and lets the per-EAN latency be swept.
 * Everything above the transport - the NDJSON decoder and its idle ceiling, the
 * retry gate, the reducer, the two progress bars, the live product feed, the
 * 50-item availability chunking, and the blockers the Review step renders - is
 * the app's own production code. See `resolve-stream-stub.ts` for why the stream
 * is installed as a `window.fetch` patch rather than a `route.fulfill`.
 *
 * WHAT IS ASSERTED, and what is only measured. Every assertion here is an
 * invariant - a request count, a resumed item set, a lower bound on distinct
 * progress states derived from the batch size, the presence of a terminal state.
 * Wall-clock numbers are printed and attached, never asserted, so the file
 * cannot go flaky on a slow machine.
 *
 * ONE NUMBER THE SWEEP MAKES VISIBLE AND DOES NOT HIDE: the resolve fan-out is
 * no longer chunked, so a batch is one request whose internal concurrency is 3,
 * where it used to be several 50-item chunks running their fan-outs in parallel.
 * A 120-variant batch at 600 ms therefore reads ~24 s of marketplace time
 * instead of ~10 s of it. That is the trade the epic made on purpose - the old
 * shape bought its wall time with nine in-flight marketplace calls, a counter
 * that could not move, and a 30 s cliff past which four whole chunks were
 * abandoned - but it is a real cost and the printed `total=` is where it shows.
 *
 * Needs a running API (for the session) and a running web app; no Allegro
 * connection and no seeded catalogue, so it is safe on any stack.
 *
 * ONE REQUIREMENT ON THE WEB APP: it must be a PRODUCTION build, which is what
 * every real stack serves. `main.tsx` mounts under `<StrictMode>`, and a
 * development React deliberately double-invokes every effect - so the resolve
 * effect fires twice, the first stream is aborted by its own cleanup, and the
 * per-attempt assertions below (which are the whole point of the retry-gating
 * cases) would be reading a dev-tool artefact rather than the app's behaviour.
 * Nothing here is relaxed to accommodate that; point the run at a built app.
 *
 * @module tests/perf
 */
import { test, expect } from '../../src/fixtures/test';
import type { Locator, Page, Route, TestInfo } from '@playwright/test';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BATCH_PROGRESS_LABEL,
  forceDarkTheme,
  installResolveStream,
  readResolveStreamState,
  resolveStreamPlan,
  type ResolveStreamPlan,
  type ResolveStreamStubState,
} from './resolve-stream-stub';

/** FE chunk size - mirrors `RESOLVE_CHUNK_SIZE` in `bulk-resolve-step.tsx`. */
const FE_RESOLVE_CHUNK_SIZE = 50;
/** Browser request timeout - mirrors `DEFAULT_TIMEOUT_MS` in `apps/web/src/app/api/api-client.ts`. */
const CLIENT_TIMEOUT_MS = 30_000;
/** How many products the live feed keeps on screen - mirrors `RESOLVE_FEED_SIZE`. */
const RESOLVE_FEED_SIZE = 4;

const CONNECTION_ID = '00000000-0000-4000-8000-00000000perf'.replace('perf', '0001');
const MASTER_CONNECTION_ID = '00000000-0000-4000-8000-000000000002';
const DELIVERY_POLICY_ID = 'perf-delivery-policy';
const RESOLVED_CATEGORY_ID = '165986';

/** Error copy the step renders when a stream ends without its terminal line. */
const TRUNCATED_STREAM_MESSAGE =
  'The resolver stopped before reporting every variant, so the results are incomplete.';
/** Error copy for a terminal line that reported `completion: 'failed'`. */
const FAILED_STREAM_MESSAGE =
  'The resolver reported a failure part-way through this batch, so the results are incomplete.';
/** The step's own error headline, shared by every failure path. */
const RESOLVE_ERROR_HEADLINE = 'Could not resolve categories and stock for this batch.';
/**
 * Aggregate readiness chips a multi-variant Review row renders (`AggregateChips`
 * in `bulk-review-step.tsx`). A collapsed row summarises its siblings rather than
 * listing each blocker chip, so this is the operator-visible statement of whether
 * anything on the row needs attention.
 */
const readyChip = (count: number): string => `${count} ready`;
const attentionChip = (count: number): string => `${count} attention`;

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
        // passes. The resolve simulator answers per the plan's outcome cycle.
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

interface Measurement {
  scenario: string;
  variants: number;
  perEanLatencyMs: number;
  /** Availability chunks - the ONLY thing still chunked on this step. */
  expectedAvailabilityChunks: number;
  /** One streamed request per attempt, with the item set it asked about. */
  resolveAttempts: ResolveStreamStubState['attempts'];
  /**
   * Attempts the browser abandoned via its own `AbortSignal`. Before #2205 this
   * was the 30 s `AbortController` in `api-client.ts` firing on a chunk that had
   * not answered; the streamed transport opts out of that deadline
   * (`requestStream` passes `timeout: false`), so a healthy run records zero.
   */
  abortedAttempts: number;
  availabilityCalls: number;
  progressStates: ProgressState[];
  /**
   * Every distinct value the batch progress bar carried, collected by a
   * `MutationObserver` in the page. This is the per-variant progress the epic
   * exists to deliver: pre-#2205 the step could only ever show as many states as
   * it had chunks.
   */
  batchProgressValues: number[];
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
 * Installs every OL route the wizard touches on the marketplace path EXCEPT the
 * resolve stream, which is served in-page (`installResolveStream`). All of these
 * answer instantly, so the measurement isolates the resolve fan-out.
 */
async function stubWizardApi(
  page: Page,
  catalogue: SyntheticProduct[],
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
        supportedCapabilities: [
          'OfferManager',
          'OfferCreator',
          'CategoryBrowser',
          'EanCategoryMatcher',
          'EanCategoryMatcherStreaming',
        ],
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

/**
 * The step's own live region, in either of its two panels: the pre-first-line
 * waiting panel is itself `role="status"`, and the streaming panel puts the
 * region on the batch bar's meta line. Scoped to the wizard body so an
 * unrelated toast can never be sampled instead.
 */
const RESOLVE_STATUS_SELECTOR =
  '.bulk-wizard__body--center[role="status"], .bulk-wizard__body--center [role="status"]';

/** Samples the Resolve step's own progress copy so a frozen counter is measurable. */
function startProgressSampling(page: Page, start: number, states: ProgressState[]): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    while (!stopped) {
      const raw = await page
        .locator(RESOLVE_STATUS_SELECTOR)
        .first()
        .textContent()
        .catch(() => null);
      if (raw !== null) {
        const text = raw.replace(/\s+/g, ' ').trim();
        const atMs = Date.now() - start;
        const last = states[states.length - 1];
        if (last && last.text === text) {
          last.lastAtMs = atMs;
          last.heldMs = atMs - last.firstAtMs;
        } else {
          states.push({ text, firstAtMs: atMs, lastAtMs: atMs, heldMs: 0 });
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  void tick();
  return () => {
    stopped = true;
  };
}

/**
 * Drives the wizard from its URL to the moment the Resolve step reaches a
 * terminal state, returning whichever it was. Racing the two rather than waiting
 * out the happy path first is deliberate: a failing run reaches its error alert
 * long before any Review heading would appear, and the measurement wants the
 * moment the operator actually learns something.
 */
async function runResolveStep(
  page: Page,
  catalogue: SyntheticProduct[],
): Promise<{
  outcome: 'review' | 'error';
  totalMs: number;
  configReadyMs: number;
  progressStates: ProgressState[];
}> {
  const productIds = catalogue.map((p) => p.id).join(',');
  const entryStart = Date.now();
  await page.goto(
    `/listings/bulk-create/wizard?productIds=${productIds}&connectionId=${CONNECTION_ID}`,
  );

  // Configure step: the Allegro contribution gates Proceed on a delivery policy.
  await expect(page.getByRole('heading', { name: 'Configure batch' })).toBeVisible({
    timeout: 60_000,
  });
  const configReadyMs = Date.now() - entryStart;
  await page.getByLabel('Shipping rate package').selectOption(DELIVERY_POLICY_ID);

  const start = Date.now();
  const progressStates: ProgressState[] = [];
  const stopSampling = startProgressSampling(page, start, progressStates);

  await page
    .getByRole('button', { name: /Proceed|Continue|Next/i })
    .first()
    .click();

  const outcome = await Promise.race([
    page
      .getByRole('heading', { name: /^Review \d+ products?$/ })
      .waitFor({ state: 'visible', timeout: 300_000 })
      .then((): 'review' => 'review'),
    page
      .getByText(RESOLVE_ERROR_HEADLINE)
      .waitFor({ state: 'visible', timeout: 300_000 })
      .then((): 'error' => 'error'),
  ]);
  const totalMs = Date.now() - start;
  stopSampling();
  return { outcome, totalMs, configReadyMs, progressStates };
}

/** Counts one `GET /products/{id}` per selected product; there is no batch read. */
function countProductDetailRequests(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (/\/v1\/products\/ol_product_perf/.test(request.url())) count += 1;
  });
  return () => count;
}

// ---------------------------------------------------------------------------
// Measurement sweep
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  products: number;
  variantsPerProduct: number;
  perEanLatencyMs: number;
}

/**
 * Latencies are the ones that matter, not a smooth sweep: 200 ms is a healthy
 * Allegro `/sale/products` response, 600 ms a typical loaded one, and 1 900 ms
 * the point where a single full 50-item chunk USED to cross the browser's 30 s
 * timeout (ceil(50/3) * 1 900 = 32 300 ms) and dead-end the step. The streamed
 * transport opts out of that deadline, so the last scenario is now the proof
 * that a slow marketplace no longer amplifies into abandoned work.
 */
const SCENARIOS: Scenario[] = [
  { name: 'small batch, healthy latency', products: 6, variantsPerProduct: 2, perEanLatencyMs: 200 },
  {
    name: 'medium batch, typical latency',
    products: 15,
    variantsPerProduct: 3,
    perEanLatencyMs: 600,
  },
  { name: 'large batch, typical latency', products: 40, variantsPerProduct: 3, perEanLatencyMs: 600 },
  {
    name: 'one chunk over the client timeout',
    products: 25,
    variantsPerProduct: 2,
    perEanLatencyMs: 1_900,
  },
];

for (const scenario of SCENARIOS) {
  test(`resolve step: ${scenario.name}`, async ({ page }, testInfo) => {
    const catalogue = buildCatalogue(scenario.products, scenario.variantsPerProduct);
    const variants = scenario.products * scenario.variantsPerProduct;
    const expectedAvailabilityChunks = Math.ceil(variants / FE_RESOLVE_CHUNK_SIZE);
    const availability = { count: 0 };

    await stubWizardApi(page, catalogue, availability);
    await installResolveStream(
      page,
      resolveStreamPlan({ perEanLatencyMs: scenario.perEanLatencyMs }),
    );
    const productDetailRequests = countProductDetailRequests(page);

    const run = await runResolveStep(page, catalogue);
    const stub = await readResolveStreamState(page);

    const measurement: Measurement = {
      scenario: scenario.name,
      variants,
      perEanLatencyMs: scenario.perEanLatencyMs,
      expectedAvailabilityChunks,
      resolveAttempts: stub.attempts,
      abortedAttempts: stub.abortedAttempts,
      availabilityCalls: availability.count,
      progressStates: run.progressStates,
      batchProgressValues: stub.batchProgressValues,
      configReadyMs: run.configReadyMs,
      productDetailRequests: productDetailRequests(),
      totalMs: run.totalMs,
      outcome: run.outcome,
    };
    await testInfo.attach('resolve-measurement.json', {
      body: JSON.stringify(measurement, null, 2),
      contentType: 'application/json',
    });

    const longestFreeze = run.progressStates.reduce((max, p) => Math.max(max, p.heldMs), 0);
    const distinctProgressStates = stub.batchProgressValues.length;
    // eslint-disable-next-line no-console -- measurement output is the point of this spec
    console.log(
      [
        `[resolve-perf] ${scenario.name}`,
        `variants=${variants}`,
        `perEan=${scenario.perEanLatencyMs}ms`,
        `configReady=${(run.configReadyMs / 1000).toFixed(1)}s(${productDetailRequests()} product GETs)`,
        `availabilityChunks=${expectedAvailabilityChunks}`,
        `resolveRequests=${stub.attempts.length}`,
        `aborted=${stub.abortedAttempts}`,
        `total=${(run.totalMs / 1000).toFixed(1)}s`,
        `longestFrozenCounter=${(longestFreeze / 1000).toFixed(1)}s`,
        `batchProgressStates=${distinctProgressStates}`,
        `outcome=${run.outcome}`,
        `progress=${run.progressStates
          .map((p) => `"${p.text}" held ${(p.heldMs / 1000).toFixed(1)}s`)
          .join(' -> ')}`,
      ].join(' '),
    );

    // Invariants, not wall-clock assertions (which would be flaky).
    // Availability is still chunked on the 50-id boundary and answers instantly.
    expect(availability.count).toBe(expectedAvailabilityChunks);
    // One product-detail request per selected product - there is no batch read.
    expect(productDetailRequests()).toBe(scenario.products);
    // The streamed transport carries the whole batch in ONE request and opts out
    // of the 30 s deadline, so no attempt is abandoned and none is re-run - not
    // even in the scenario that used to spend 200 EAN lookups for zero delivered
    // results across four abandoned attempts.
    expect(stub.abortedAttempts).toBe(0);
    expect(stub.attempts).toHaveLength(1);
    expect(stub.attempts[0].requestedVariantIds).toHaveLength(variants);
    expect(run.outcome).toBe('review');
    // Progress is now per variant, not per chunk: the bar's own state count is
    // bounded below by the batch size rather than by the number of chunks (which
    // is 1 here, and was at most 3 before #2205). Half is the floor, so a slow
    // machine coalescing some renders cannot make this flaky.
    expect(distinctProgressStates).toBeGreaterThanOrEqual(Math.ceil(variants / 2));
    expect(Math.max(...stub.batchProgressValues)).toBe(variants);
    // Monotonic: a bar that went backwards would mean a variant was counted twice.
    for (let i = 1; i < stub.batchProgressValues.length; i++) {
      expect(stub.batchProgressValues[i]).toBeGreaterThan(stub.batchProgressValues[i - 1]);
    }
    // The counter can no longer stand still for a whole client-timeout window.
    // Generous by two orders of magnitude over the pacing interval, so this is a
    // ceiling on the FAILURE mode, not a performance threshold.
    expect(longestFreeze).toBeLessThan(CLIENT_TIMEOUT_MS);
  });
}

// ---------------------------------------------------------------------------
// Regression guard (#2212)
// ---------------------------------------------------------------------------

/** Small enough to keep each case a few seconds, multi-variant so siblings fan out. */
const GUARD_PRODUCTS = 4;
const GUARD_VARIANTS_PER_PRODUCT = 2;
const GUARD_VARIANTS = GUARD_PRODUCTS * GUARD_VARIANTS_PER_PRODUCT;

async function arrangeGuardRun(
  page: Page,
  plan: ResolveStreamPlan,
  products = GUARD_PRODUCTS,
): Promise<SyntheticProduct[]> {
  const catalogue = buildCatalogue(products, GUARD_VARIANTS_PER_PRODUCT);
  await stubWizardApi(page, catalogue, { count: 0 });
  await installResolveStream(page, plan);
  return catalogue;
}

test('a stream that ends without its terminal line surfaces the error state, never Review', async ({
  page,
}) => {
  const catalogue = await arrangeGuardRun(
    page,
    resolveStreamPlan({
      perEanLatencyMs: 300,
      cut: 'truncate',
      linesBeforeCut: 3,
      // Never recovers, so the error state is what the operator is left with.
      cutAttempts: Number.MAX_SAFE_INTEGER,
    }),
  );

  const run = await runResolveStep(page, catalogue);

  expect(run.outcome).toBe('error');
  await expect(page.getByRole('alert').first()).toContainText(RESOLVE_ERROR_HEADLINE);
  await expect(page.getByRole('alert').first()).toContainText(TRUNCATED_STREAM_MESSAGE);
  // Retry is reachable, and what it would pick up from is stated.
  await expect(page.getByRole('button', { name: 'Retry resolve' })).toBeVisible();
  await expect(
    page.getByText(`3 of ${GUARD_VARIANTS} variants already resolved`),
  ).toBeVisible();
  // A truncated body is a 200 with the right lines missing, so the only thing
  // that can stop it being read as success is the absent terminal line.
  await expect(page.getByRole('heading', { name: /^Review \d+ products?$/ })).toHaveCount(0);
});

test("a terminal line reporting completion 'failed' surfaces the error state too", async ({
  page,
}) => {
  const catalogue = await arrangeGuardRun(
    page,
    resolveStreamPlan({
      perEanLatencyMs: 300,
      cut: 'failed-terminal',
      linesBeforeCut: 2,
      cutAttempts: Number.MAX_SAFE_INTEGER,
    }),
  );

  const run = await runResolveStep(page, catalogue);

  expect(run.outcome).toBe('error');
  await expect(page.getByRole('alert').first()).toContainText(FAILED_STREAM_MESSAGE);
  await expect(page.getByRole('button', { name: 'Retry resolve' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Review \d+ products?$/ })).toHaveCount(0);
});

test('a stream that terminates at once advances to Review with no 0% flash', async ({ page }) => {
  const catalogue = await arrangeGuardRun(page, resolveStreamPlan({ immediate: true }));

  const run = await runResolveStep(page, catalogue);
  const stub = await readResolveStreamState(page);

  expect(run.outcome).toBe('review');
  expect(stub.attempts).toHaveLength(1);
  expect(stub.attempts[0].deliveredVariantIds).toHaveLength(GUARD_VARIANTS);
  // Epic #2205 decision 4: the whole point of keeping the pre-first-line panel
  // separate is that two tracks must never render at 0% for a destination whose
  // stream is already over. The bar either never appeared or appeared complete.
  expect(stub.batchProgressValues).not.toContain(0);
  // Same claim from the other side: the FIRST state the bar ever carried was
  // already a resolved variant, so no empty track was painted on the way in.
  expect(stub.batchProgressValues[0]).toBeGreaterThan(0);
  expect(Math.max(...stub.batchProgressValues)).toBe(GUARD_VARIANTS);
});

test('a failure before any line auto-retries the whole batch', async ({ page }) => {
  const catalogue = await arrangeGuardRun(
    page,
    resolveStreamPlan({
      perEanLatencyMs: 300,
      cut: 'reject-cold',
      // One rejection, then a clean run: the #1709 cold-start shape (an Allegro
      // OAuth token exchange timing out on the first call) that `shouldRetryTransient`
      // exists for.
      cutAttempts: 1,
    }),
  );

  const run = await runResolveStep(page, catalogue);
  const stub = await readResolveStreamState(page);

  // Reaching Review at all is the assertion: the retry was automatic, so the
  // operator was never shown the error state and never had to click anything.
  expect(run.outcome).toBe('review');
  expect(stub.attempts).toHaveLength(2);
  expect(stub.attempts[0].deliveredVariantIds).toHaveLength(0);
  // Nothing had been delivered, so the retry legitimately re-asks for everything.
  expect(stub.attempts[1].requestedVariantIds).toHaveLength(GUARD_VARIANTS);
});

test('a failure after lines have arrived resumes instead of re-running resolved variants', async ({
  page,
}) => {
  const deliveredBeforeCut = 3;
  const catalogue = await arrangeGuardRun(
    page,
    resolveStreamPlan({
      perEanLatencyMs: 300,
      cut: 'error-mid',
      linesBeforeCut: deliveredBeforeCut,
      // The first attempt is cut; the retry runs clean, so the resume is
      // observable all the way to Review.
      cutAttempts: 1,
    }),
  );

  const first = await runResolveStep(page, catalogue);
  expect(first.outcome).toBe('error');

  const afterFailure = await readResolveStreamState(page);
  // NOT auto-retried: progress had been made, so restarting would re-spend the
  // marketplace calls that already succeeded (epic #2205 decision 3).
  expect(afterFailure.attempts).toHaveLength(1);
  const delivered = afterFailure.attempts[0].deliveredVariantIds;
  expect(delivered).toHaveLength(deliveredBeforeCut);
  await expect(
    page.getByText(`${deliveredBeforeCut} of ${GUARD_VARIANTS} variants already resolved`),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Retry resolve' }).click();
  await expect(page.getByRole('heading', { name: /^Review \d+ products?$/ })).toBeVisible({
    timeout: 120_000,
  });

  const afterRetry = await readResolveStreamState(page);
  expect(afterRetry.attempts).toHaveLength(2);
  const resumed = afterRetry.attempts[1].requestedVariantIds;
  expect(resumed).toHaveLength(GUARD_VARIANTS - deliveredBeforeCut);
  for (const variantId of delivered) {
    expect(resumed).not.toContain(variantId);
  }
});

test('catalogueLookupPerformed false does not turn no-match rows into category blockers', async ({
  page,
}) => {
  const catalogue = await arrangeGuardRun(
    page,
    resolveStreamPlan({
      // The real shape of a destination with no EAN matcher, its own or borrowed:
      // one `no-match` per item, emitted together, and a terminal saying no
      // catalogue was consulted (#1045 / epic #2205 decision 4).
      immediate: true,
      outcomeCycle: ['no-match'],
      catalogueLookupPerformed: false,
    }),
  );

  const run = await runResolveStep(page, catalogue);

  expect(run.outcome).toBe('review');
  // Every row is `no-match`, and NONE of them may read as needing attention:
  // those `no-match` values say nothing about the operator's barcodes, and
  // arming the category blocker on them is the #1934/F10 mistake in reverse.
  await expect(
    page.getByText(readyChip(GUARD_VARIANTS_PER_PRODUCT), { exact: true }),
  ).toHaveCount(GUARD_PRODUCTS);
  await expect(
    page.getByText(attentionChip(GUARD_VARIANTS_PER_PRODUCT), { exact: true }),
  ).toHaveCount(0);
});

test('catalogueLookupPerformed true does flag the same no-match rows', async ({ page }) => {
  // Control for the case above: without it, a Review step that stopped rendering
  // blocker chips at all would pass the assertion that matters.
  const catalogue = await arrangeGuardRun(
    page,
    resolveStreamPlan({
      immediate: true,
      outcomeCycle: ['no-match'],
      catalogueLookupPerformed: true,
    }),
  );

  const run = await runResolveStep(page, catalogue);

  expect(run.outcome).toBe('review');
  await expect(
    page.getByText(attentionChip(GUARD_VARIANTS_PER_PRODUCT), { exact: true }),
  ).toHaveCount(GUARD_PRODUCTS);
  await expect(
    page.getByText(readyChip(GUARD_VARIANTS_PER_PRODUCT), { exact: true }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Loader visuals (#2212) - dark theme, desktop viewport
// ---------------------------------------------------------------------------

test.describe('resolve loader visuals', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });

  /** Writes the shot next to the report AND under `test-results/` by a stable name. */
  async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const fileName = `2212-${name}.png`;
    const attached = testInfo.outputPath(fileName);
    await page.screenshot({ path: attached });
    const stable = join(testInfo.project.outputDir, fileName);
    await mkdir(testInfo.project.outputDir, { recursive: true });
    await copyFile(attached, stable);
    await testInfo.attach(fileName, { path: attached, contentType: 'image/png' });
  }

  const batchBar = (page: Page): Locator =>
    page.getByRole('progressbar', { name: BATCH_PROGRESS_LABEL });

  async function waitForResolved(page: Page, atLeast: number): Promise<void> {
    await expect
      .poll(
        async () => Number((await batchBar(page).getAttribute('aria-valuenow')) ?? '0'),
        { timeout: 120_000, intervals: [50] },
      )
      .toBeGreaterThanOrEqual(atLeast);
  }

  test('streamed loader, early / mid / mixed outcomes', async ({ page }, testInfo) => {
    // 8 products x 2 siblings, cycling the three outcomes so all three feed
    // chips are reachable, paced slowly enough that a screenshot lands where it
    // is aimed (perEan 1500 / concurrency 3 = one line every 500 ms).
    const products = 8;
    const catalogue = buildCatalogue(products, GUARD_VARIANTS_PER_PRODUCT);
    const variants = products * GUARD_VARIANTS_PER_PRODUCT;
    await stubWizardApi(page, catalogue, { count: 0 });
    await forceDarkTheme(page);
    await installResolveStream(
      page,
      resolveStreamPlan({
        perEanLatencyMs: 1_500,
        outcomeCycle: ['matched', 'mapping', 'no-match'],
      }),
    );

    const productIds = catalogue.map((p) => p.id).join(',');
    await page.goto(
      `/listings/bulk-create/wizard?productIds=${productIds}&connectionId=${CONNECTION_ID}`,
    );
    await expect(page.getByRole('heading', { name: 'Configure batch' })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByLabel('Shipping rate package').selectOption(DELIVERY_POLICY_ID);
    await page
      .getByRole('button', { name: /Proceed|Continue|Next/i })
      .first()
      .click();

    await waitForResolved(page, 2);
    await shoot(page, testInfo, 'loader-early');

    // Products 0, 1 and 2 complete -> matched / mapping / no-match, and the feed
    // keeps the last four, so all three chips are on screen at once.
    await waitForResolved(page, 3 * GUARD_VARIANTS_PER_PRODUCT);
    await expect(page.getByText('Matched in catalog').first()).toBeVisible();
    await expect(page.getByText('From category mapping').first()).toBeVisible();
    await expect(page.getByText('Needs a category').first()).toBeVisible();
    await shoot(page, testInfo, 'loader-mixed-outcomes');

    await waitForResolved(page, Math.ceil(variants / 2));
    await shoot(page, testInfo, 'loader-mid-run');

    // The feed is bounded, which is part of what the shots document.
    expect(await page.locator('.bulk-wizard__resolve-feed .bulk-progress__row').count()).toBe(
      RESOLVE_FEED_SIZE,
    );

    await expect(page.getByRole('heading', { name: /^Review \d+ products?$/ })).toBeVisible({
      timeout: 180_000,
    });
  });

  test('error state after a truncated stream', async ({ page }, testInfo) => {
    const catalogue = await arrangeGuardRun(
      page,
      resolveStreamPlan({
        perEanLatencyMs: 600,
        cut: 'truncate',
        linesBeforeCut: 3,
        cutAttempts: Number.MAX_SAFE_INTEGER,
      }),
    );
    await forceDarkTheme(page);

    const run = await runResolveStep(page, catalogue);
    expect(run.outcome).toBe('error');
    await expect(page.getByRole('button', { name: 'Retry resolve' })).toBeVisible();
    await shoot(page, testInfo, 'loader-truncated-error');
  });
});
