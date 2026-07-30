/**
 * F9 - `flat`/`cap` stock policies are offered for multi-variant products and
 * discarded by the backend; the publish downgrade is unlogged and unwarnable
 *
 * ⚠️ CHARACTERIZATION TEST. It passes while the divergence exists and FAILS the
 * moment the finding is closed (or was wrong in the first place). A red run here
 * is a signal to re-read the finding, not a regression in the product.
 *
 * ── WHAT THE AUDIT RETRACTED (do not re-litigate) ────────────────────────────
 * The version-3 headline "the stock shown in Review is fiction" was WRONG. Under
 * the DEFAULT `use-master` policy the displayed value is exactly the submitted
 * one: the Resolve step reads `item.totalAvailable`, the same field the backend
 * reads, and `computeResolvedStock` returns it verbatim. The wizard also warns
 * correctly there - the edit modal renders a master provenance badge, a readOnly
 * input and the hint "Authoritative from master inventory. Out-of-stock lists as
 * 0, never backfilled.", refuses to emit a base stock override for a
 * multi-variant product, and the review summary prints 'per variant'. None of
 * that is tested here. Only what survived the retraction is:
 *
 *   (1) OFFERED-THEN-DISCARDED. `flat` and `cap` are offered for a multi-variant
 *       product (batch-wide radios on the config step, plus a per-product "Stock
 *       policy" select in the edit modal), and `buildVariantOverride` duly emits
 *       the resolved value as `perVariantOverrides[variantId].stock`. The
 *       backend then ignores it: `buildEnqueueInput` computes
 *         stock = job.useMasterStock ? (masterAvailable ?? 0) : operatorStock
 *       and `useMasterStock` is TRUE for every sibling of a multi-variant
 *       product. The operator's number never reaches the offer.
 *         (a) is asserted in the browser: the Review row DISPLAYS the flat value.
 *         (b) is asserted against the persisted request snapshot: the record
 *             carries master availability, not the submitted number.
 *
 *   (2) UNLOGGED, UNWARNABLE DOWNGRADE. `publishEffective = stock > 0 ?
 *       publishImmediately : false` silently turns a zero-stock sibling into a
 *       draft, with no log line; and the wizard's only pre-submit warning
 *       (`mixedPublish`) is derived purely from explicit per-row publish flags,
 *       so it cannot warn about a downgrade caused by stock. Test 3 documents
 *       why this half is not reproducible on this stack.
 *
 * Side effects: test 1 submits ONE real batch (created as drafts,
 * `publishImmediately: false`) for a multi-variant product. Test 2 is a
 * read-only browser walk that stops at Review.
 *
 * @module tests/preflight-divergence
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import { captureProof, reviewRegion } from './__proof__/capture';

/** Per-variant override entry of `POST /listings/bulk-create`. */
interface BulkOverride {
  stock?: number;
  publishImmediately?: boolean;
  price?: { amount: number; currency: string };
  overrides?: Record<string, unknown>;
}

/** Request body of `POST /listings/bulk-create` (mirrored locally, #1741 shape). */
interface BulkCreateBody {
  connectionId: string;
  productIds: string[];
  sharedConfig: { stock: number; publishImmediately: boolean };
  perProductOverrides?: Record<string, BulkOverride>;
  perVariantOverrides?: Record<string, BulkOverride>;
  excludedVariantIds?: string[];
}

interface Candidate {
  product: Product;
  free: ProductVariant[];
}

/** The "flat stock" an operator types. Deliberately unlike any master quantity. */
const FLAT_STOCK = 777;

test.describe('F9 - flat/cap stock policy on a multi-variant product', () => {
  test('the wizard emits the operator flat stock per variant; the backend writes master stock instead', async ({
    api,
    world,
    env,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'F9 needs an Allegro connection as the wizard destination.');
    const connection = allegro!;

    const candidate = await findMultiVariantCandidate(api, world, connection.id);
    test.skip(
      candidate === null,
      'F9 needs a MULTI-variant master product with >= 2 variants that have no Allegro offer ' +
        'mapping yet. `useMasterStock` is only true for siblings of a multi-variant product, ' +
        'so a single-variant product cannot exhibit the discard; and mapped variants are ' +
        'dropped by `filterAlreadyListed` before any of this runs.',
    );
    const { product, free } = candidate!;

    const availability = await api.inventory.availability(free.map((v) => v.id));
    const masterByVariant = new Map(
      availability.map((row) => [row.productVariantId, row.totalAvailable]),
    );
    expect(
      free.every((v) => (masterByVariant.get(v.id) ?? 0) !== FLAT_STOCK),
      `master availability must differ from the flat value ${FLAT_STOCK}, else the assertion ` +
        'below could not tell the two apart',
    ).toBe(true);

    // Exactly the body a `flat` stock policy produces: `buildVariantOverride`
    // stamps the policy-resolved value onto every included sibling.
    const perVariantOverrides: Record<string, BulkOverride> = {};
    for (const variant of free) {
      perVariantOverrides[variant.id] = { stock: FLAT_STOCK, publishImmediately: false };
    }

    const result = await submitBulkCreate(env, {
      connectionId: connection.id,
      productIds: [free[0].id],
      sharedConfig: { stock: 1, publishImmediately: false },
      perVariantOverrides,
      excludedVariantIds: [],
    });
    expect(
      result.status,
      `the flat-stock body is accepted without complaint: ${JSON.stringify(result.body)}`,
    ).toBe(202);

    const batchId = (result.body as { batchId?: string }).batchId;
    expect(batchId, 'the accept response carries a batchId').toBeTruthy();
    const batch = await api.listings.getBulkBatch(batchId!);
    expect(
      batch.records.length,
      'the multi-variant product fanned out to one record per sibling',
    ).toBeGreaterThanOrEqual(2);

    // The persisted request snapshot is the offer's own resolved input - the
    // authoritative answer to "what stock did the backend actually use?".
    let checked = 0;
    for (const record of batch.records) {
      const master = masterByVariant.get(record.internalVariantId);
      if (master === undefined) continue;
      const detail = await api.listings.getOfferCreationRecord(connection.id, record.id);
      expect(
        detail.request?.stock,
        `variant ${record.internalVariantId}: the operator's flat ${FLAT_STOCK} was DISCARDED - ` +
          'the enqueued offer carries master availability, because `useMasterStock` is true ' +
          'for every sibling of a multi-variant product',
      ).toBe(master);
      expect(
        detail.request?.stock,
        'and it is emphatically not the number the wizard offered to set',
      ).not.toBe(FLAT_STOCK);
      checked += 1;
    }
    expect(checked, 'at least one record was inspected against master availability')
      .toBeGreaterThan(0);

    // Belt and braces: the product this ran against is genuinely multi-variant,
    // which is the precondition the whole finding hinges on.
    const variants = await world.variantsOf(product.id);
    expect(variants.length, 'the fixture product is multi-variant').toBeGreaterThan(1);
  });

  test('the wizard offers flat/cap for a multi-variant product and displays the flat value', async ({ page, pages, world }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'F9 needs an Allegro connection as the wizard destination.');

    // Readiness does not depend on offer mappings, so this read-only half can use
    // ANY multi-variant product and leaves the unmapped ones for test 1.
    const product = await findAnyMultiVariantProduct(world);
    test.skip(product === null, 'F9 UI half needs any multi-variant master product.');

    await page.goto(
      `/listings/bulk-create/wizard?productIds=${encodeURIComponent(product!.id)}` +
        `&connectionId=${encodeURIComponent(allegro!.id)}`,
    );
    await expect(page.getByRole('heading', { name: 'Configure batch' })).toBeVisible({
      timeout: 30_000,
    });

    // (1a) The policy is offered - for a batch the wizard KNOWS is multi-variant
    // (its own header prints the variant count).
    await expect(
      page.getByText(/·\s*\d+\s*variants/i),
      'the wizard knows this batch is multi-variant',
    ).toBeVisible();
    const flatStockRadio = page.getByRole('radio', { name: /Flat stock for all rows/ });
    await expect(
      flatStockRadio,
      'the `flat` stock policy is offered with no multi-variant caveat, even though the ' +
        'backend will discard it for every sibling',
    ).toBeVisible();
    await flatStockRadio.check();

    const stockFieldset = page
      .locator('fieldset.bulk-config__policy')
      .filter({ hasText: 'Stock policy' });
    const flatInput = stockFieldset.locator('input[type="number"]').last();
    await flatInput.fill(String(FLAT_STOCK));

    // Allegro gates Proceed on its own config section (shipping-rate package);
    // reuse the suite's page object rather than re-deriving the control here.
    await pages.bulkOfferWizard.completePlatformConfig({ requiresDeliveryPolicy: true });
    const proceed = page.getByRole('button', { name: /^Proceed/ });
    await expect(proceed).toBeEnabled({ timeout: 60_000 });
    await proceed.click();

    await expect(page.locator('button.bulk-review__cta--top')).toBeVisible({ timeout: 60_000 });
    await page.locator('button.bulk-review__toggle').first().click();

    // (1a cont.) …and the Review step DISPLAYS that number as the per-variant
    // stock, which is the operator-facing half of the contradiction: the value
    // shown is the one the backend is about to throw away.
    const stockCells = page.locator('.bulk-review__vrow .bulk-review__c-stock');
    await expect
      .poll(async () => stockCells.count(), {
        message: 'per-variant rows render with a stock cell',
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    // PROOF (documentation only - never asserted on): the promise - the Review
    // step showing the operator's flat stock per sibling. There is no
    // `f09-before-result.png` counterpart: the discard is only observable in the
    // persisted request snapshot (test 1), which no screen renders.
    await captureProof(page, 'f09-before-review-ready', { region: reviewRegion(page) });

    const shown = await stockCells.allInnerTexts();
    expect(
      shown.map((s) => s.trim()),
      `the Review step shows the flat ${FLAT_STOCK} for the siblings - a value the backend ` +
        'replaces with master availability at enqueue time (see test 1)',
    ).toContain(String(FLAT_STOCK));
  });

  test('the unlogged publish-downgrade half is unprovisionable on this stack', async ({
    api,
    world,
  }) => {
    // Enumerate the exact missing state so the skip message is actionable.
    const zeroStockMultiVariant: string[] = [];
    for (const product of await world.listProducts(100)) {
      const variants = await world.variantsOf(product.id);
      if (variants.length < 2) continue;
      const availability = await api.inventory.availability(variants.map((v) => v.id));
      const byVariant = new Map(availability.map((r) => [r.productVariantId, r.totalAvailable]));
      for (const variant of variants) {
        if ((byVariant.get(variant.id) ?? 0) <= 0) zeroStockMultiVariant.push(variant.id);
      }
    }
    test.skip(
      true,
      'BLOCKED ON FIXTURE. Observing `publishEffective = stock > 0 ? publishImmediately : ' +
        'false` needs a sibling of a MULTI-variant product whose master availability is 0 (or ' +
        'which has no inventory row at all, since `masterAvailable ?? 0` collapses both). Only ' +
        'then does the backend flip a submit that asked for `publishImmediately: true` into a ' +
        'draft - with no log line and no wizard warning, because `mixedPublish` is derived ' +
        'solely from explicit per-row publish flags. The operator-supplied stock cannot force ' +
        'it either: that is exactly the value F9 half 1 proves is discarded. This stack has ' +
        `${zeroStockMultiVariant.length} such sibling(s), so the state cannot be reached; the ` +
        'two zero-stock variants present belong to SINGLE-variant products, where ' +
        '`useMasterStock` is false and the operator stock is used verbatim. Provisioning it ' +
        'needs a PrestaShop combination set to 0 stock (OL_PS_WEBSERVICE_KEY is unset by ' +
        'default and the webservice helper cannot address individual combinations).',
    );
  });
});

/** First multi-variant product with >= 2 variants unmapped on `connectionId`. */
async function findMultiVariantCandidate(
  api: ApiClient,
  world: {
    listProducts(limit?: number): Promise<Product[]>;
    variantsOf(id: string): Promise<ProductVariant[]>;
  },
  connectionId: string,
): Promise<Candidate | null> {
  const mapped = await mappedVariantIds(api, connectionId);
  for (const product of await world.listProducts(100)) {
    const variants = await world.variantsOf(product.id);
    if (variants.length < 2) continue;
    const free = variants.filter((v) => !mapped.has(v.id));
    if (free.length >= 2) return { product, free };
  }
  return null;
}

async function findAnyMultiVariantProduct(world: {
  listProducts(limit?: number): Promise<Product[]>;
  variantsOf(id: string): Promise<ProductVariant[]>;
}): Promise<Product | null> {
  for (const product of await world.listProducts(100)) {
    const variants = await world.variantsOf(product.id);
    if (variants.length > 1) return product;
  }
  return null;
}

async function mappedVariantIds(api: ApiClient, connectionId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await api.listings.list({ connectionId, limit: 100, offset });
    page.items.forEach((mapping) => ids.add(mapping.internalId));
    if (page.items.length === 0 || offset + 100 >= page.total) break;
  }
  return ids;
}

/**
 * Raw `POST /listings/bulk-create`. The node `ApiClient` exposes no bulk-submit
 * method and this suite must not modify `src/`, so the call is issued directly
 * here. Returns status + parsed body rather than throwing.
 */
async function submitBulkCreate(
  env: E2eEnv,
  body: BulkCreateBody,
): Promise<{ status: number; body: unknown }> {
  const token = await loginForRawCalls(env);
  const response = await fetch(`${env.apiUrl}/v1/listings/bulk-create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'x-idempotency-key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch {
    /* non-JSON body - keep the raw text */
  }
  return { status: response.status, body: parsed };
}

async function loginForRawCalls(env: E2eEnv): Promise<string> {
  const response = await fetch(`${env.apiUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.adminUser, password: env.adminPass }),
  });
  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { access_token: string }).access_token;
}
