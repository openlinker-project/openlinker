/**
 * F11 - a master product name over 75 characters is never measured
 *
 * CHARACTERIZATION TEST. It asserts BOTH sides of one divergence:
 *   (a) a master product whose name exceeds the destination's 75-character title
 *       limit renders `ready` in the bulk offer wizard - no blocker, no chip, no
 *       warning. The ONLY place that limit exists on the client is the per-row
 *       edit modal (`maxLength=75` + a schema cap), which this test proves by
 *       opening the editor and watching the save be refused, AND
 *   (b) the submission is accepted (202) because the request carries NO `title`
 *       override - `@MaxLength(75)` only guards a title that WAS sent - and OL
 *       never measures the `product.name` the offer builder falls back to: no
 *       OL-side error ever mentions the title, and no offer is created.
 *
 * The test PASSES while the divergence exists. It FAILS if the wizard starts
 * flagging the row, if the request starts carrying a bounded title, or if OL
 * starts reporting a title-length problem (builder gate, or a marketplace
 * rejection that finally reaches the operator) - all of which mean the finding
 * was wrong or has been closed.
 *
 * Fixture policy: REUSE FIRST, provision only as a last resort. The fixture is a
 * master product whose name exceeds the title cap, and there is no way to lengthen
 * an existing catalogue name without mutating shared data - so the first run has
 * to create one. But `PrestashopWebserviceClient` exposes no delete, so every
 * provisioning run strands a product on the shared shop forever. This spec
 * therefore looks for a fixture a PREVIOUS run already left behind (an
 * `E2E preflight F11 …` product, still over-length, still unlisted on the
 * destination, still stocked, still resolving to a product card) and only
 * provisions when the catalogue offers none. The spec creates no offer (it is
 * submitted with "Publish immediately" unchecked, and on the stack this was
 * written against the record dies before any marketplace call), so its own
 * fixture stays reusable by the next run. Which path was taken is annotated.
 *
 * @module tests/preflight-divergence
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Connection, Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
import { JobType } from '../../src/support/jobs';
import type { World } from '../../src/world/world';

test.describe.configure({ mode: 'serial', timeout: 600_000 });

/** The title cap the FE editor and the request DTO both encode. */
const TITLE_MAX = 75;

/**
 * Name prefix every fixture this spec has ever created carries. It is the handle
 * a later run recognises its predecessor's product by - so keep it stable, and
 * keep it in sync with `buildFixtureName` below.
 */
const FIXTURE_NAME_PREFIX = 'E2E preflight F11';

function buildFixtureName(reference: string): string {
  return (
    `${FIXTURE_NAME_PREFIX} characterization product with a deliberately over-long master ` +
    `catalogue name ${reference}`
  );
}

/* ────────────────────────── local fixture discovery ────────────────────────── */

/** A destination that owns its taxonomy (advertises the EAN->category matcher). */
function pickOwnsTaxonomyOfferDestination(world: World): Connection | undefined {
  return world
    .connectionsWithCapability('OfferCreator')
    .find(
      (connection) =>
        connection.status === 'active' &&
        connection.supportedCapabilities.includes('EanCategoryMatcher'),
    );
}

/**
 * The master-catalogue connection this fixture can provision a product on: it
 * must have `ProductMaster` actually ENABLED (not merely advertised - a shop
 * kept as a publish target advertises it too) and expose a PrestaShop-shaped
 * webservice URL, since provisioning goes through `PrestashopWebserviceClient`.
 */
function pickMasterCatalogue(env: E2eEnv, world: World): Connection | undefined {
  return world
    .connectionsWithCapability('ProductMaster')
    .filter(
      (connection) =>
        connection.status === 'active' &&
        connection.enabledCapabilities.includes('ProductMaster'),
    )
    .find((connection) => webserviceBaseUrl(env, connection) !== null);
}

/**
 * Host-reachable base URL for the PrestaShop webservice. The connection's own
 * `baseUrl` is often the in-cluster hostname, so prefer the explicit override,
 * then the storefront URL, before falling back to it.
 */
function webserviceBaseUrl(env: E2eEnv, connection: Connection): string | null {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const candidates = [
    env.psAdminUrl,
    typeof config['storefrontBaseUrl'] === 'string' ? config['storefrontBaseUrl'] : null,
    typeof config['baseUrl'] === 'string' ? config['baseUrl'] : null,
  ];
  return candidates.find((value): value is string => !!value && /^https?:\/\//.test(value)) ?? null;
}

interface CatalogueRow {
  product: Product;
  /** Master image URLs (not in the suite's mirrored `Product` type). */
  images: string[];
  variants: ProductVariant[];
}

async function loadCatalogue(api: ApiClient): Promise<CatalogueRow[]> {
  const summaries: Product[] = [];
  for (let offset = 0; ; offset += 50) {
    const page = await api.products.list({ limit: 50, offset });
    summaries.push(...page.items);
    if (offset + 50 >= page.total || page.items.length === 0) break;
  }
  const rows: CatalogueRow[] = [];
  for (const summary of summaries) {
    const detail = (await api.products.getById(summary.id)) as Product & { images?: string[] };
    const variants =
      detail.variants && detail.variants.length > 0
        ? detail.variants
        : (await api.products.listVariants(summary.id)).items;
    rows.push({ product: detail, images: detail.images ?? [], variants });
  }
  return rows;
}

/** Every variant id that already carries an offer mapping on `connectionId`. */
async function listedVariantIds(api: ApiClient, connectionId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await api.listings.list({ connectionId, limit: 100, offset });
    page.items.forEach((mapping) => ids.add(mapping.internalId));
    if (page.items.length === 0 || offset + 100 >= page.total) break;
  }
  return ids;
}

/**
 * A fixture an earlier run of THIS spec left behind that is still usable, or
 * `null`. Every condition mirrors what the provisioning path guarantees, so a
 * reused fixture puts the test in exactly the state a fresh one would:
 *
 *   1. Named with this spec's prefix - never adopt an unrelated product, whose
 *      name a future run might depend on staying short.
 *   2. Still longer than the title cap (the whole point of the fixture).
 *   3. Carries a variant that has NO offer mapping on the destination yet -
 *      `filterAlreadyListed` would otherwise drop it and the submit would die on
 *      F2's empty-batch path instead of reaching the assertions below.
 *   4. That variant's barcode still resolves to a product card, which is what
 *      releases the required-parameter blocker and lets the row read `ready`
 *      without the operator editing it.
 *   5. It still carries stock - a zero-stock row would be flagged for the WRONG
 *      reason.
 */
async function findReusableFixture(
  api: ApiClient,
  catalogue: CatalogueRow[],
  resolved: Record<string, ResolveBatchResult>,
  listed: Set<string>,
): Promise<{ product: Product; variant: ProductVariant } | null> {
  for (const { product, variants } of catalogue) {
    if (!product.name.startsWith(FIXTURE_NAME_PREFIX)) continue;
    if (product.name.length <= TITLE_MAX) continue;
    for (const variant of variants) {
      if (listed.has(variant.id)) continue;
      const match = resolved[variant.id];
      if (match?.kind !== 'matched' || !match.productCardId) continue;
      const availability = await api.inventory.availability([variant.id]);
      if ((availability[0]?.totalAvailable ?? 0) <= 0) continue;
      return { product, variant };
    }
  }
  return null;
}

async function bearerToken(env: E2eEnv): Promise<string> {
  const response = await fetch(`${env.apiUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.adminUser, password: env.adminPass }),
  });
  if (!response.ok) throw new Error(`E2E login failed: HTTP ${response.status}`);
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

interface ResolveBatchResult {
  kind: string;
  productCardId?: string;
}

/**
 * The wizard's own Resolve-step call. A `matched` result with a `productCardId`
 * is what releases the FE's required-parameter blocker, i.e. what lets a row on
 * a taxonomy-owning destination be `ready` without the operator editing it -
 * which is the state this finding is about.
 */
async function resolveBatch(
  env: E2eEnv,
  token: string,
  connectionId: string,
  items: Array<{ variantId: string; ean: string; sourceCategoryIds: string[] }>,
): Promise<Record<string, ResolveBatchResult>> {
  const out: Record<string, ResolveBatchResult> = {};
  for (let i = 0; i < items.length; i += 20) {
    const response = await fetch(
      `${env.apiUrl}/v1/listings/connections/${connectionId}/categories/resolve-batch`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.slice(i, i + 20) }),
      },
    );
    if (!response.ok) continue;
    const body = (await response.json()) as { results?: Record<string, ResolveBatchResult> };
    Object.assign(out, body.results ?? {});
  }
  return out;
}

interface BatchRecordWithErrors {
  id: string;
  internalVariantId: string;
  status: string;
  externalOfferId: string | null;
  errors: Array<{ field: string; code: string; message: string }> | null;
}

interface BatchWithErrors {
  id: string;
  status: string;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  records: BatchRecordWithErrors[];
}

/** Raw read - the shared `BulkBatchSummary` type omits the per-record `errors[]`. */
async function getBatch(env: E2eEnv, token: string, batchId: string): Promise<BatchWithErrors> {
  const response = await fetch(`${env.apiUrl}/v1/listings/bulk-create/${batchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`GET bulk-create/${batchId} -> HTTP ${response.status}`);
  return (await response.json()) as BatchWithErrors;
}

/* ─────────────────────────────── wizard driving ─────────────────────────────── */

async function openWizard(
  page: Page,
  target: { productId: string; variantId: string; connectionId: string },
): Promise<void> {
  const query = new URLSearchParams({
    productIds: target.productId,
    variantIds: target.variantId,
    connectionId: target.connectionId,
  });
  await page.goto(`/listings/bulk-create/wizard?${query.toString()}`);
  await expect(
    page.getByRole('heading', { name: 'Bulk marketplace offer creation' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function completeConfigAndProceed(page: Page): Promise<void> {
  const proceed = page.getByRole('button', { name: /^Proceed/ });
  await expect(proceed).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    const selects = page.locator('select');
    const count = await selects.count();
    for (let index = 0; index < count; index += 1) {
      const select = selects.nth(index);
      if (!(await select.isEnabled())) continue;
      if ((await select.inputValue()) !== '') continue;
      const value = await select.locator('option:not([value=""])').first().getAttribute('value');
      if (value) await select.selectOption(value);
    }
    expect(await proceed.isEnabled(), 'Config step "Proceed" should unlock').toBe(true);
  }).toPass({ timeout: 90_000 });
  await proceed.click();
}

function reviewCta(page: Page): Locator {
  return page.getByRole('button', { name: /^Create offers \(\d+\)$/ }).first();
}

interface ReviewCounts {
  ready: number;
  attention: number;
  excluded: number;
}

async function reviewCounts(page: Page): Promise<ReviewCounts> {
  const summary = page.getByRole('status').filter({ hasText: /ready/i }).first();
  const text = (await summary.innerText()).replace(/\s+/g, ' ');
  const read = (pattern: RegExp): number => {
    const match = pattern.exec(text);
    return match ? Number(match[1]) : 0;
  };
  return {
    ready: read(/(\d+)\s*ready/i),
    attention: read(/(\d+)\s*need attention/i),
    excluded: read(/(\d+)\s*excluded/i),
  };
}

async function waitForReview(page: Page): Promise<ReviewCounts> {
  await expect(reviewCta(page)).toBeVisible({ timeout: 90_000 });
  let counts: ReviewCounts = { ready: 0, attention: 0, excluded: 0 };
  await expect(async () => {
    counts = await reviewCounts(page);
    const settled = counts.ready > 0 || counts.attention > 0 || counts.excluded > 0;
    expect(settled, 'Review step should settle into per-row statuses').toBe(true);
  }).toPass({ timeout: 90_000 });
  return counts;
}

interface SubmitResult {
  status: number;
  body: unknown;
  requestBody: string | null;
}

async function submitFromReview(page: Page): Promise<SubmitResult> {
  await reviewCta(page).click();
  const dialog = page.getByRole('dialog');
  const publishAnyway = dialog.getByRole('button', { name: /Publish anyway/ });
  if (await publishAnyway.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await publishAnyway.click();
  }
  const confirmButton = page.getByRole('button', { name: 'Create offers', exact: true });
  await expect(confirmButton).toBeVisible({ timeout: 30_000 });
  const publishToggle = page.getByRole('checkbox', { name: /Publish immediately/ });
  if (await publishToggle.count()) await publishToggle.uncheck();

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/listings/bulk-create') &&
        candidate.request().method() === 'POST',
      { timeout: 60_000 },
    ),
    confirmButton.click(),
  ]);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep the raw text */
  }
  return { status: response.status(), body, requestBody: response.request().postData() };
}

/* ──────────────────────────────── the scenario ──────────────────────────────── */

test.describe('F11: an over-length master name is never measured by the wizard or by OL', () => {
  test('a 100+ character product name is ready, submits 202 with no title, and OL never flags it', async ({
    page,
    api,
    world,
    env,
    jobs,
    poll,
  }, testInfo) => {
    const destination = pickOwnsTaxonomyOfferDestination(world);
    test.skip(
      !destination,
      'No active OfferCreator connection advertising EanCategoryMatcher (a taxonomy-owning ' +
        'destination such as Allegro, whose 75-character title limit the FE editor encodes).',
    );
    const connection = destination!;
    const token = await bearerToken(env);

    // A barcode that resolves to a marketplace product card is what makes the
    // row `ready` unedited - reuse one already present in the catalogue.
    const catalogue = await loadCatalogue(api);
    const flat = catalogue.flatMap(({ product, variants }) =>
      variants.map((variant) => ({
        variantId: variant.id,
        ean: variant.ean ?? variant.gtin ?? '',
        name: product.name,
      })),
    );
    const withEan = flat.filter((row) => row.ean.length > 0);
    const resolved = await resolveBatch(
      env,
      token,
      connection.id,
      withEan.map((row) => ({ variantId: row.variantId, ean: row.ean, sourceCategoryIds: ['2'] })),
    );

    // ── the fixture: adopt a previous run's, or (only then) create one ────────
    const listed = await listedVariantIds(api, connection.id);
    const reusable = await findReusableFixture(api, catalogue, resolved, listed);

    let product: Product;
    let variant: ProductVariant;

    if (reusable) {
      product = reusable.product;
      variant = reusable.variant;
      testInfo.annotations.push({
        type: 'fixture',
        description:
          `reused: master product ${product.id} ("${product.name.slice(0, 40)}…", ` +
          `${product.name.length} chars) left behind by an earlier run - nothing provisioned`,
      });
    } else {
      const master = pickMasterCatalogue(env, world);
      test.skip(
        !master,
        'No reusable `E2E preflight F11 …` fixture on the stack, and no active connection with ' +
          'ProductMaster ENABLED and a host-reachable shop URL (config.storefrontBaseUrl / ' +
          'config.baseUrl, or OL_PS_ADMIN_URL) to provision the over-long-named master product on.',
      );
      const baseUrl = master ? webserviceBaseUrl(env, master) : null;
      test.skip(
        !env.psWebserviceKey || !baseUrl,
        'No reusable `E2E preflight F11 …` fixture on the stack, so one must be created - which ' +
          'needs OL_PS_WEBSERVICE_KEY (and a host-reachable master-shop URL via OL_PS_ADMIN_URL or ' +
          "the connection's storefrontBaseUrl). No pre-existing catalogue product can be used " +
          `without renaming shared data, because the fixture's whole point is a name over ` +
          `${TITLE_MAX} characters.`,
      );
      const cardEan = withEan.find((row) => {
        const result = resolved[row.variantId];
        return result?.kind === 'matched' && !!result.productCardId;
      })?.ean;
      test.skip(
        !cardEan,
        `No barcode in the catalogue resolves to a product card on "${connection.name}". The fresh ` +
          'fixture needs one, otherwise its row carries a required-parameter blocker and its ' +
          'readiness could not be asserted. Publish one offer on that destination (which creates ' +
          'the card) or import a product whose EAN exists in its catalogue.',
      );

      const shop = new PrestashopWebserviceClient({
        baseUrl: baseUrl!,
        apiKey: env.psWebserviceKey!,
      });
      const reference = `E2E-F11-${Date.now()}`;
      const longName = buildFixtureName(reference);
      expect(
        longName.length,
        'fixture sanity: the master name must exceed the title cap',
      ).toBeGreaterThan(TITLE_MAX);
      const created = await shop.createProduct({
        name: longName,
        reference,
        ean13: cardEan!,
        price: '19.99',
        quantity: 25,
      });
      testInfo.annotations.push({
        type: 'fixture',
        description:
          `provisioned and left behind (the webservice client cannot delete): master-shop product ` +
          `${created.id} (${reference}), name ${longName.length} chars. Later runs adopt it instead ` +
          'of creating another.',
      });

      await jobs.triggerAndWait(
        { connectionId: master!.id, jobType: JobType.masterProductSyncAll },
        { timeoutMs: 240_000 },
      );
      product = await poll.until(
        async () => (await api.products.list({ search: reference, limit: 5 })).items[0],
        (value) => !!value,
        { timeoutMs: 180_000, intervalMs: 5_000, message: `master product ${reference} to reach OL` },
      );
      const variants = await api.products.listVariants(product.id);
      variant = variants.items[0];
      expect(variant, 'the imported product has a variant to list').toBeTruthy();
      // The first inventory pass after an import can miss a just-created product
      // (its fan-out snapshot predates the row), so run the sync until the fresh
      // variant actually carries stock - a zero-stock row would be flagged by the
      // wizard for the WRONG reason. (The reuse path asserts stock as an adoption
      // precondition instead, so it never needs this.)
      let stocked = false;
      for (let attempt = 0; attempt < 3 && !stocked; attempt += 1) {
        await jobs.triggerAndWait(
          { connectionId: master!.id, jobType: JobType.masterInventorySyncAll },
          { timeoutMs: 240_000 },
        );
        stocked = await poll
          .until(
            () => api.inventory.availability([variant.id]),
            (items) => (items[0]?.totalAvailable ?? 0) > 0,
            { timeoutMs: 60_000, intervalMs: 5_000, message: 'the fixture variant to carry stock' },
          )
          .then(() => true)
          .catch(() => false);
      }
      expect(stocked, 'the fixture variant must carry stock before the wizard sees it').toBe(true);
    }

    expect(
      product.name.length,
      'the over-length name survived the import unchanged (OL never truncates it)',
    ).toBeGreaterThan(TITLE_MAX);

    // ── (a) the wizard side ───────────────────────────────────────────────────
    await openWizard(page, {
      productId: product.id,
      variantId: variant.id,
      connectionId: connection.id,
    });
    await completeConfigAndProceed(page);
    const counts = await waitForReview(page);
    expect(
      counts.attention,
      'an over-length product name is not a wizard blocker',
    ).toBe(0);
    expect(counts.ready).toBe(1);
    await expect(reviewCta(page)).toBeEnabled();
    // `attention === 0` above IS the "no title blocker" proof: the review step's
    // only per-row signal is the blocker chip set, and none of them measures the
    // title (the row would otherwise be counted as needing attention).

    // The FE limit exists ONLY inside the row editor: it holds the full
    // over-length name, caps typing at 75, and refuses to save it.
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    const editor = page.getByRole('dialog').first();
    await expect(editor.getByRole('button', { name: 'Save all' })).toBeVisible({ timeout: 20_000 });
    const titleField = editor.getByLabel('Title');
    expect(
      (await titleField.inputValue()).length,
      'the editor seeds the full master name, unbounded',
    ).toBe(product.name.length);
    expect(await titleField.getAttribute('maxlength')).toBe(String(TITLE_MAX));
    await editor.getByRole('button', { name: 'Save all' }).click();
    await expect(
      editor,
      'the editor is the ONLY client-side title gate: it refuses to save the over-length name',
    ).toBeVisible({ timeout: 10_000 });
    await editor.getByRole('button', { name: 'Cancel' }).click();
    const discard = page.getByRole('dialog').getByRole('button', { name: /Discard/ });
    if (await discard.isVisible({ timeout: 3_000 }).catch(() => false)) await discard.click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });

    // ── (b) the backend side ──────────────────────────────────────────────────
    const submitted = await submitFromReview(page);
    expect(
      submitted.requestBody ?? '',
      'the unedited row sends NO title override, so @MaxLength(75) can never apply',
    ).not.toContain('"title"');
    expect(submitted.status, `request: ${submitted.requestBody}`).toBe(202);
    const { batchId } = submitted.body as { batchId: string };

    const batch = await poll.until(
      () => getBatch(env, token, batchId),
      (value) => value.status !== 'running' && value.status !== 'pending',
      {
        timeoutMs: 240_000,
        intervalMs: 3_000,
        message: `bulk batch ${batchId} to reach a terminal status`,
      },
    );
    const errors = batch.records.flatMap((record) => record.errors ?? []);
    const titleComplaint = errors.find((error) =>
      /title|name|75|length/i.test(`${error.field} ${error.code} ${error.message}`),
    );
    expect(
      titleComplaint,
      'OL never measures the `product.name` it falls back to - no layer reports the over-length title',
    ).toBeUndefined();
    expect(
      batch.records.every((record) => record.externalOfferId === null),
      'the over-length row never produced a live offer either',
    ).toBe(true);
    expect(batch.succeededCount, 'the row the wizard called ready did not list').toBe(0);

    testInfo.annotations.push({
      type: 'divergence',
      description:
        `master name ${product.name.length} chars: wizard ready=${counts.ready}, submit 202 with ` +
        `no title override; batch ${batchId} -> ${batch.status}, errors: ` +
        (errors.map((error) => `${error.field}/${error.code}`).join(', ') || '(none)'),
    });
  });
});
