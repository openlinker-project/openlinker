/**
 * F4 - destination without `masterCatalogConnectionId`: 100% green, 100% failed
 *
 * CHARACTERIZATION TEST. It asserts BOTH sides of one divergence:
 *   (a) with the destination connection missing `config.masterCatalogConnectionId`,
 *       the bulk offer wizard still renders every row `ready`, enables the submit
 *       CTA, and the API accepts the batch (202) - the preflight never looks at
 *       that config key, AND
 *   (b) every child record then terminates `failed` with
 *       `MASTER_CATALOG_NOT_CONFIGURED` on `connection.config.masterCatalogConnectionId`,
 *       because the offer builder resolves the master catalogue only at execution.
 *
 * The test PASSES while the divergence exists. A failure means the finding was
 * wrong or the divergence has been closed (the wizard now blocks/warns, or the
 * submit endpoint rejects a destination with no master catalogue).
 *
 * Fixture policy: this is the only spec in this suite that mutates shared state -
 * it must temporarily remove ONE key from the destination connection's config
 * (connection config is replaced wholesale, so the full object is written back).
 * The original config is restored in a `finally` AND re-asserted in `afterAll`,
 * which fails loudly if the stack was left in the doctored state. No offer is
 * created on the marketplace: every record dies in the builder, before any
 * platform call.
 *
 * @module tests/preflight-divergence
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Connection, Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import type { World } from '../../src/world/world';
import { captureProof, reviewRegion } from './__proof__/capture';

test.describe.configure({ mode: 'serial', timeout: 420_000 });

const MASTER_CATALOG_KEY = 'masterCatalogConnectionId';

/** Set by the test before it doctors a connection, so `afterAll` can verify/repair. */
let doctored: { connectionId: string; config: Record<string, unknown> } | null = null;

/* ────────────────────────── local fixture discovery ────────────────────────── */

interface VariantCandidate {
  productId: string;
  variantId: string;
  ean: string;
  price: number;
  stock: number;
}

/** A borrows-taxonomy destination: its rows go `ready` without per-row editing. */
function pickBorrowsOfferDestination(world: World): Connection | undefined {
  return world
    .connectionsWithCapability('OfferCreator')
    .find(
      (connection) =>
        connection.status === 'active' &&
        !connection.supportedCapabilities.includes('EanCategoryMatcher'),
    );
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

async function listedVariantIds(api: ApiClient, connectionId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await api.listings.list({ connectionId, limit: 100, offset });
    page.items.forEach((mapping) => ids.add(mapping.internalId));
    if (offset + 100 >= page.total || page.items.length === 0) break;
  }
  return ids;
}

async function stockByVariant(api: ApiClient, variantIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (let i = 0; i < variantIds.length; i += 40) {
    const items = await api.inventory.availability(variantIds.slice(i, i + 40));
    items.forEach((item) => result.set(item.productVariantId, item.totalAvailable));
  }
  return result;
}

/** Priced, in-stock, barcoded variants that are NOT yet listed on the destination. */
async function findUnlistedCandidates(
  api: ApiClient,
  connectionId: string,
): Promise<VariantCandidate[]> {
  const [catalogue, listed] = await Promise.all([
    loadCatalogue(api),
    listedVariantIds(api, connectionId),
  ]);
  const flat = catalogue
    // A row with no master image is flagged by the destination's own validator,
    // so it could never be `ready` - exclude it from candidate selection.
    .filter((row) => row.images.length > 0)
    .flatMap(({ product, variants }) =>
      variants.map((variant) => ({
        productId: product.id,
        variantId: variant.id,
        ean: variant.ean ?? variant.gtin ?? '',
        price: variant.price ?? product.price ?? 0,
      })),
    );
  const stock = await stockByVariant(
    api,
    flat.map((row) => row.variantId),
  );
  return flat
    .map((row) => ({ ...row, stock: stock.get(row.variantId) ?? 0 }))
    .filter((row) => row.ean.length > 0 && row.price > 0 && row.stock > 0)
    .filter((row) => !listed.has(row.variantId));
}

/* ─────────────────────────── raw API helpers (local) ────────────────────────── */

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

interface BatchRecordWithErrors {
  id: string;
  internalVariantId: string;
  status: string;
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

/**
 * `GET /listings/bulk-create/:batchId`, read raw because the suite's shared
 * `BulkBatchSummary` type omits the per-record `errors[]` this test asserts on.
 */
async function getBatch(env: E2eEnv, token: string, batchId: string): Promise<BatchWithErrors> {
  const response = await fetch(`${env.apiUrl}/v1/listings/bulk-create/${batchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`GET bulk-create/${batchId} -> HTTP ${response.status}`);
  return (await response.json()) as BatchWithErrors;
}

/* ─────────────────────────────── wizard driving ─────────────────────────────── */

interface WizardTarget {
  productIds: string[];
  variantIds: string[];
  connectionId: string;
}

async function openWizard(page: Page, target: WizardTarget): Promise<void> {
  const query = new URLSearchParams({
    productIds: [...new Set(target.productIds)].join(','),
    variantIds: target.variantIds.join(','),
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

test.afterAll(async ({ api }) => {
  // Safety net: the test restores in its own `finally`; this re-asserts the
  // shared connection really is back to its original config, and repairs it if
  // the test died before its `finally` ran.
  if (!doctored) return;
  const current = await api.connections.getById(doctored.connectionId);
  if (current.config?.[MASTER_CATALOG_KEY] === undefined) {
    await api.connections.update(doctored.connectionId, { config: doctored.config });
  }
  const repaired = await api.connections.getById(doctored.connectionId);
  expect(
    repaired.config?.[MASTER_CATALOG_KEY],
    `connection ${doctored.connectionId} must be left with its original ${MASTER_CATALOG_KEY}`,
  ).toBe(doctored.config[MASTER_CATALOG_KEY]);
});

test.describe('F4: destination with no master catalogue - every row ready, every record failed', () => {
  test('the wizard is 100% green and the batch is 100% MASTER_CATALOG_NOT_CONFIGURED', async ({
    page,
    api,
    world,
    env,
    poll,
  }, testInfo) => {
    const destination = pickBorrowsOfferDestination(world);
    test.skip(
      !destination,
      'No active OfferCreator connection without EanCategoryMatcher (a borrows-taxonomy ' +
        'destination such as Erli). Needed because its rows go `ready` without the operator ' +
        'filling required category parameters, so "every row green" is assertable.',
    );
    const connection = destination!;
    const token = await bearerToken(env);

    const original = await api.connections.getById(connection.id);
    const originalConfig = (original.config ?? {}) as Record<string, unknown>;
    test.skip(
      originalConfig[MASTER_CATALOG_KEY] === undefined,
      `Connection "${connection.name}" has no ${MASTER_CATALOG_KEY} to remove. Configure a ` +
        'master catalogue on it first (Connections -> Edit -> master catalogue), so the test can ' +
        'temporarily clear it and restore it.',
    );

    const candidates = await findUnlistedCandidates(api, connection.id);
    test.skip(
      candidates.length === 0,
      `No priced, in-stock, barcoded variant that is NOT yet listed on "${connection.name}". ` +
        'An already-listed variant would be dropped before any record is created (F2). ' +
        'Sync a fresh master product, or unlist one.',
    );
    const { [MASTER_CATALOG_KEY]: removed, ...withoutMasterCatalog } = originalConfig;
    doctored = { connectionId: connection.id, config: originalConfig };

    try {
      await api.connections.update(connection.id, { config: withoutMasterCatalog });
      const doctoredConnection = await api.connections.getById(connection.id);
      expect(
        doctoredConnection.config?.[MASTER_CATALOG_KEY],
        'precondition: the destination now has no master catalogue configured',
      ).toBeUndefined();

      // (a) The wizard never mentions the missing master catalogue: rows are
      // ready, nothing needs attention, and submit is enabled + accepted.
      // Candidates are tried in turn because an individual variant can carry an
      // unrelated blocker (a destination-specific field the catalogue lacks);
      // what matters is that SOME row is green while the master catalogue is gone.
      let counts: ReviewCounts | null = null;
      const attempts: string[] = [];
      for (const candidate of candidates.slice(0, 3)) {
        await openWizard(page, {
          productIds: [candidate.productId],
          variantIds: [candidate.variantId],
          connectionId: connection.id,
        });
        await completeConfigAndProceed(page);
        const seen = await waitForReview(page);
        attempts.push(
          `${candidate.variantId} -> ready=${seen.ready} attention=${seen.attention}`,
        );
        if (seen.attention === 0 && seen.ready > 0) {
          counts = seen;
          break;
        }
      }
      expect(
        counts,
        'a destination with no master catalogue produces no wizard-side blocker, so at least ' +
          `one candidate row must be fully ready (tried: ${attempts.join('; ')})`,
      ).not.toBeNull();
      await expect(reviewCta(page)).toBeEnabled();

      // PROOF (documentation only - never asserted on): the promise.
      await captureProof(page, 'f04-before-review-ready', { region: reviewRegion(page) });

      const submitted = await submitFromReview(page);
      expect(submitted.status, `request: ${submitted.requestBody}`).toBe(202);
      const { batchId } = submitted.body as { batchId: string; jobIds: string[] };

      // (b) Every child record dies in the builder with the config error the
      // wizard could have checked before the operator ever clicked submit.
      const batch = await poll.until(
        () => getBatch(env, token, batchId),
        (value) => value.status !== 'running' && value.status !== 'pending',
        {
          timeoutMs: 180_000,
          intervalMs: 3_000,
          message: `bulk batch ${batchId} to reach a terminal status`,
        },
      );
      // PROOF (documentation only): what actually happened to the green batch.
      await captureProof(page, 'f04-before-result', {
        fullPage: true,
        prepare: async () => {
          await page.goto(`/listings/bulk-batches/${batchId}`);
          await page.locator('button[aria-label^="Failure details for"]').first().click();
          await expect(page.locator('.bulk-batch__err-list').first()).toBeVisible({
            timeout: 15_000,
          });
        },
      });

      expect(batch.failedCount, 'every record in the batch fails').toBe(batch.totalCount);
      expect(batch.succeededCount).toBe(0);
      const codes = batch.records.flatMap((record) =>
        (record.errors ?? []).map((error) => error.code),
      );
      expect(
        codes,
        'the failure is the config gate the preflight never checked',
      ).toContain('MASTER_CATALOG_NOT_CONFIGURED');
      const fields = batch.records.flatMap((record) =>
        (record.errors ?? []).map((error) => error.field),
      );
      expect(fields).toContain(`connection.config.${MASTER_CATALOG_KEY}`);

      testInfo.annotations.push({
        type: 'divergence',
        description:
          `wizard: ${counts!.ready} ready / ${counts!.attention} attention, submit 202; ` +
          `batch ${batchId}: ${batch.failedCount}/${batch.totalCount} failed with ` +
          `${[...new Set(codes)].join(', ')}`,
      });
    } finally {
      await api.connections.update(connection.id, { config: originalConfig });
      const restored = await api.connections.getById(connection.id);
      expect(
        restored.config?.[MASTER_CATALOG_KEY],
        `the destination's ${MASTER_CATALOG_KEY} must be restored`,
      ).toBe(removed);
    }
  });
});
