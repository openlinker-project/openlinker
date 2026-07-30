/**
 * F2 - already-listed variants: the wizard promises a duplicate, the backend drops them
 *
 * CHARACTERIZATION TEST. Every test here asserts BOTH sides of one divergence:
 *   (a) the bulk offer wizard presents the row as `ready` and lets the operator
 *       submit (its duplicate guard even promises "creates a duplicate offer"), AND
 *   (b) the backend silently removes those variants from the submission
 *       (`filterAlreadyListed` in `BulkListingSubmitService`) - so the batch is
 *       smaller than the wizard promised, or the whole request 400s with a
 *       message about `productId`s the operator never saw.
 *
 * These tests PASS while the divergence exists. A failure here means the finding
 * was wrong or the divergence has been closed (e.g. the preflight now excludes
 * already-listed variants, the response reports which variants were dropped, or
 * a force/allow-duplicates flag reaches the server). In that case re-read the
 * finding before "fixing" the test.
 *
 * Fixture policy: nothing is mutated except the batch each scenario submits.
 * Scenario 1 legitimately creates ONE real offer (that is the surviving variant);
 * it is submitted with "Publish immediately" unchecked so the destination gets a
 * draft. Scenarios 2 and 3 never reach the worker - they end in a 400.
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

test.describe.configure({ mode: 'serial', timeout: 300_000 });

/* ────────────────────────── local fixture discovery ────────────────────────── */

interface VariantCandidate {
  productId: string;
  variantId: string;
  ean: string;
  price: number;
  stock: number;
}

/**
 * A destination whose wizard rows go `ready` WITHOUT the operator opening the
 * per-row editor: a borrows-taxonomy destination (it does not own an EAN->category
 * matcher, so the FE suppresses the category/parameter blockers - ADR-025, and
 * finding F10). Resolved by capability, never by platformType.
 */
function pickBorrowsOfferDestination(world: World): Connection | undefined {
  return world
    .connectionsWithCapability('OfferCreator')
    .find(
      (connection) =>
        connection.status === 'active' &&
        !connection.supportedCapabilities.includes('EanCategoryMatcher'),
    );
}

/** A destination that OWNS its taxonomy (Allegro-shaped): it advertises the EAN matcher. */
function pickOwnsTaxonomyOfferDestination(world: World): Connection | undefined {
  return world
    .connectionsWithCapability('OfferCreator')
    .find(
      (connection) =>
        connection.status === 'active' &&
        connection.supportedCapabilities.includes('EanCategoryMatcher'),
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

/** Every variant id that already carries an offer mapping on the connection. */
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

/**
 * Variants the wizard can render as `ready` on a borrows destination: priced,
 * in stock, barcoded. Split by whether they already carry an offer mapping on
 * the destination.
 */
async function findCandidates(
  api: ApiClient,
  connectionId: string,
): Promise<{ listed: VariantCandidate[]; unlisted: VariantCandidate[] }> {
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
  const usable = flat
    .map((row) => ({ ...row, stock: stock.get(row.variantId) ?? 0 }))
    .filter((row) => row.ean.length > 0 && row.price > 0 && row.stock > 0);
  return {
    listed: usable.filter((row) => listed.has(row.variantId)),
    unlisted: usable.filter((row) => !listed.has(row.variantId)),
  };
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

interface OfferStatusSnapshot {
  connectionId: string;
  externalOfferId: string;
  internalVariantId: string;
  publicationStatus: string;
}

/** `GET /listings/products/:productId/offer-status` - not on the shared ApiClient. */
async function offerStatusFor(
  env: E2eEnv,
  token: string,
  productId: string,
): Promise<OfferStatusSnapshot[]> {
  const response = await fetch(`${env.apiUrl}/v1/listings/products/${productId}/offer-status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  return (await response.json()) as OfferStatusSnapshot[];
}

interface ResolveBatchResult {
  kind: string;
  productCardId?: string;
}

/**
 * `POST /listings/connections/:id/categories/resolve-batch` - the same call the
 * wizard's Resolve step makes. A `matched` result carrying a `productCardId` is
 * what releases the FE's required-parameter blocker on a taxonomy-owning
 * destination, i.e. what makes a row `ready` without the operator editing it.
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

/**
 * Complete the Config step: every platform-config select the destination
 * lazily populates (shipping-rate package / delivery price list / producer)
 * gets its first real option, then "Proceed" is clicked once it unlocks.
 */
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

/** Wait until the Review step has settled (blockers computed) and return its counts. */
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

interface ConfirmStep {
  /** The duplicate-guard modal text, when the wizard showed one. */
  duplicateGuardText: string | null;
  /** The confirm step's own promise ("You're about to create N offers on ..."). */
  confirmText: string;
}

/** Click the review CTA, walk the duplicate guard, and land on the Confirm step. */
async function goToConfirm(page: Page): Promise<ConfirmStep> {
  await reviewCta(page).click();
  const dialog = page.getByRole('dialog');
  let duplicateGuardText: string | null = null;
  const publishAnyway = dialog.getByRole('button', { name: /Publish anyway/ });
  if (await publishAnyway.isVisible({ timeout: 5_000 }).catch(() => false)) {
    duplicateGuardText = (await dialog.first().innerText()).replace(/\s+/g, ' ').trim();
    await publishAnyway.click();
  }
  const confirmButton = page.getByRole('button', { name: 'Create offers', exact: true });
  await expect(confirmButton).toBeVisible({ timeout: 30_000 });
  return {
    duplicateGuardText,
    confirmText: (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim(),
  };
}

interface SubmitResult {
  status: number;
  body: unknown;
  requestBody: string | null;
}

/** Submit from the Confirm step and capture the raw `POST /listings/bulk-create` exchange. */
async function submitFromConfirm(
  page: Page,
  options: { publishImmediately: boolean },
): Promise<SubmitResult> {
  const publishToggle = page.getByRole('checkbox', { name: /Publish immediately/ });
  if (await publishToggle.count()) {
    if (options.publishImmediately) await publishToggle.check();
    else await publishToggle.uncheck();
  }
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/listings/bulk-create') &&
        candidate.request().method() === 'POST',
      { timeout: 60_000 },
    ),
    page.getByRole('button', { name: 'Create offers', exact: true }).click(),
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

/* ──────────────────────────────── the scenarios ─────────────────────────────── */

test.describe('F2: already-listed variants counted ready, then silently dropped', () => {
  test('mixed batch: the wizard promises N offers, the backend keeps only the unlisted one', async ({
    page,
    api,
    world,
  }, testInfo) => {
    const destination = pickBorrowsOfferDestination(world);
    test.skip(
      !destination,
      'No active OfferCreator connection without EanCategoryMatcher (a borrows-taxonomy ' +
        'destination such as Erli). Needed because only such a destination renders rows ' +
        '`ready` without the operator filling required category parameters per row. ' +
        'Create/activate one to run this scenario.',
    );
    const connection = destination!;

    const { listed, unlisted } = await findCandidates(api, connection.id);
    test.skip(
      listed.length === 0 || unlisted.length === 0,
      `Stack has ${listed.length} already-listed and ${unlisted.length} not-yet-listed ` +
        `priced/in-stock/barcoded variants on "${connection.name}". The mixed batch needs at ` +
        'least 1 of each: list a variant on that connection (bulk wizard) and leave another unlisted.',
    );

    const alreadyListed = listed.slice(0, 3);
    const fresh = unlisted[0];
    const chosen = [...alreadyListed, fresh];

    await openWizard(page, {
      productIds: chosen.map((row) => row.productId),
      variantIds: chosen.map((row) => row.variantId),
      connectionId: connection.id,
    });
    await completeConfigAndProceed(page);
    const counts = await waitForReview(page);

    // (a) The wizard side: every already-listed variant counts as READY.
    expect(
      counts.ready,
      'the wizard should count every selected variant (already-listed included) as ready',
    ).toBe(chosen.length);
    expect(counts.attention).toBe(0);

    const alreadyChip = page.getByText(/already on /i).first();
    await expect(
      alreadyChip,
      'the review step should flag the already-listed variants with an "already on {destination}" chip',
    ).toBeVisible();

    const confirm = await goToConfirm(page);
    expect(
      confirm.duplicateGuardText,
      'the duplicate guard should appear for already-listed variants',
    ).not.toBeNull();
    expect(
      confirm.duplicateGuardText,
      'the guard promises a DUPLICATE offer - the exact opposite of what the backend does',
    ).toMatch(/creates a duplicate offer/i);
    expect(
      confirm.confirmText,
      `the confirm step should promise all ${chosen.length} offers`,
    ).toMatch(new RegExp(`about to create ${chosen.length} offers`, 'i'));

    const submitted = await submitFromConfirm(page, { publishImmediately: false });

    // (b) The backend side: the already-listed variants never reach a job.
    expect(submitted.status, `submit body: ${submitted.requestBody}`).toBe(202);
    const response = submitted.body as { batchId: string; jobIds: string[] };
    expect(
      response.jobIds.length,
      `the wizard promised ${chosen.length} offers; the backend enqueued ${response.jobIds.length}`,
    ).toBeLessThan(chosen.length);

    const batch = await api.listings.getBulkBatch(response.batchId);
    expect(
      batch.totalCount,
      'the persisted batch is smaller than the wizard promised - the drop is never reported back',
    ).toBeLessThan(chosen.length);
    const recordedVariantIds = batch.records.map((record) => record.internalVariantId);
    for (const dropped of alreadyListed) {
      expect(
        recordedVariantIds,
        `already-listed variant ${dropped.variantId} was dropped without any response field naming it`,
      ).not.toContain(dropped.variantId);
    }
    expect(recordedVariantIds).toContain(fresh.variantId);

    testInfo.annotations.push({
      type: 'divergence',
      description:
        `wizard promised ${chosen.length} offers, batch ${response.batchId} holds ` +
        `${batch.totalCount} (dropped: ${alreadyListed.map((row) => row.variantId).join(', ')})`,
    });
  });

  test('all-already-listed batch: ready rows, then a 400 about productIds the operator never saw', async ({
    page,
    api,
    world,
  }, testInfo) => {
    const destination = pickBorrowsOfferDestination(world);
    test.skip(
      !destination,
      'No active OfferCreator connection without EanCategoryMatcher (borrows-taxonomy ' +
        'destination). See the mixed-batch scenario for why.',
    );
    const connection = destination!;

    const { listed } = await findCandidates(api, connection.id);
    test.skip(
      listed.length === 0,
      `No already-listed, priced, in-stock, barcoded variant on "${connection.name}". ` +
        'Create at least one offer there first (bulk wizard) so the variant carries an offer mapping.',
    );

    const chosen = listed.slice(0, 2);
    await openWizard(page, {
      productIds: chosen.map((row) => row.productId),
      variantIds: chosen.map((row) => row.variantId),
      connectionId: connection.id,
    });
    await completeConfigAndProceed(page);
    const counts = await waitForReview(page);

    // (a) Every row is ready and the submit CTA is enabled.
    expect(counts.ready).toBe(chosen.length);
    expect(counts.attention).toBe(0);
    await expect(reviewCta(page)).toBeEnabled();

    // PROOF (documentation only - never asserted on): the promise.
    await captureProof(page, 'f02-before-review-ready', { region: reviewRegion(page) });

    const confirm = await goToConfirm(page);
    expect(confirm.duplicateGuardText).toMatch(/creates a duplicate offer/i);

    // (b) The backend removes every variant, then complains the request is empty.
    const submitted = await submitFromConfirm(page, { publishImmediately: false });

    // PROOF (documentation only): the 400 the confirm modal renders back.
    await captureProof(page, 'f02-before-result', {
      region: page.getByRole('dialog').filter({ has: page.locator('.alert--error') }),
      prepare: async () => {
        await expect(page.locator('.alert--error').first()).toBeVisible({ timeout: 15_000 });
      },
    });

    expect(submitted.status).toBe(400);
    const message = JSON.stringify(submitted.body);
    expect(
      message,
      'the 400 talks about missing productIds - not about the variants being already listed',
    ).toMatch(/at least one productId/i);

    testInfo.annotations.push({
      type: 'divergence',
      description: `wizard said ${counts.ready} ready; server replied 400 ${message}`,
    });
  });

  test('an offer that is no longer live still blocks its variant forever', async ({
    page,
    api,
    world,
    env,
  }, testInfo) => {
    // The "already listed" test is a bare offer-mapping lookup with no join to
    // `offer_status_snapshots`, so a variant whose offer is no longer publicly
    // live is still refused. The audit's sharpest case is an `ended` offer;
    // ending an Allegro offer is a manual, external act, so this test accepts
    // ANY non-active publication status as the reachable proxy and names the
    // status it actually found.
    const destination = pickOwnsTaxonomyOfferDestination(world);
    test.skip(
      !destination,
      'No active OfferCreator connection advertising EanCategoryMatcher (a taxonomy-owning ' +
        'destination such as Allegro). Offer-status snapshots only exist for such a destination.',
    );
    const connection = destination!;
    const token = await bearerToken(env);

    const { listed } = await findCandidates(api, connection.id);
    test.skip(
      listed.length === 0,
      `No already-listed, priced, in-stock, barcoded variant on "${connection.name}".`,
    );

    // A row on a taxonomy-owning destination only reaches `ready` unedited when
    // its barcode resolves to a marketplace product card.
    const resolved = await resolveBatch(
      env,
      token,
      connection.id,
      listed.map((row) => ({
        variantId: row.variantId,
        ean: row.ean,
        sourceCategoryIds: ['2'],
      })),
    );
    const cardMatched = listed.filter((row) => {
      const result = resolved[row.variantId];
      return result?.kind === 'matched' && !!result.productCardId;
    });

    const rank = (status: string): number =>
      ({ ended: 0, removed: 1, unpublished: 2, inactive: 3, draft: 4 })[status] ?? 9;
    const staleCandidates: Array<{ candidate: (typeof listed)[number]; status: string }> = [];
    for (const candidate of cardMatched) {
      const snapshots = await offerStatusFor(env, token, candidate.productId);
      const snapshot = snapshots
        .filter(
          (row) =>
            row.connectionId === connection.id &&
            row.internalVariantId === candidate.variantId &&
            row.publicationStatus !== 'active',
        )
        .sort((a, b) => rank(a.publicationStatus) - rank(b.publicationStatus))[0];
      if (snapshot) staleCandidates.push({ candidate, status: snapshot.publicationStatus });
    }
    staleCandidates.sort((a, b) => rank(a.status) - rank(b.status));

    test.skip(
      staleCandidates.length === 0,
      `No variant on "${connection.name}" that is (1) already listed, (2) barcode-matched to a ` +
        'marketplace product card (so its wizard row is ready unedited) and (3) carries an ' +
        'offer-status snapshot that is NOT `active`. To create that state: end (or deactivate) ' +
        'one of the connection\'s offers on the marketplace, then let the ' +
        '`marketplace.offer.statusSync` job refresh its snapshot.',
    );

    const stale = staleCandidates[0];
    testInfo.annotations.push({
      type: 'fixture',
      description: `variant ${stale.candidate.variantId} - offer publicationStatus "${stale.status}"`,
    });

    await openWizard(page, {
      productIds: [stale.candidate.productId],
      variantIds: [stale.candidate.variantId],
      connectionId: connection.id,
    });
    await completeConfigAndProceed(page);
    const counts = await waitForReview(page);

    // (a) Ready, and the wizard offers to re-create the offer.
    expect(
      counts.ready,
      `the wizard should present the variant (offer status "${stale.status}") as ready`,
    ).toBe(1);
    await expect(reviewCta(page)).toBeEnabled();
    await expect(page.getByText(/already on /i).first()).toBeVisible();

    const confirm = await goToConfirm(page);
    expect(confirm.duplicateGuardText).toMatch(/creates a duplicate offer/i);

    // (b) The backend still treats the stale offer as "listed" and refuses.
    const submitted = await submitFromConfirm(page, { publishImmediately: false });
    expect(
      submitted.status,
      `a variant whose offer is "${stale.status}" should have been re-listable`,
    ).toBe(400);
    expect(JSON.stringify(submitted.body)).toMatch(/at least one productId/i);
  });
});
