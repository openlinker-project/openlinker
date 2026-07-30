/**
 * F3 - price `0`: the wizard accepts it everywhere, the API rejects the whole batch
 *
 * CHARACTERIZATION TEST. Each test asserts BOTH sides of one divergence:
 *   (a) the bulk offer wizard accepts a zero price (the flat-price config field has
 *       no floor, unlike its markup / cap / flat-stock neighbours), keeps the rows
 *       `ready`, and lets the operator submit, AND
 *   (b) `POST /listings/bulk-create` rejects the ENTIRE request with 400 and an
 *       opaque, non-field-level message (`...price: invalid value`), because the
 *       price DTO is `@IsPositive()` and is enforced per map value.
 *
 * These tests PASS while the divergence exists. A failure here means the finding
 * was wrong or the divergence has been closed (a client-side floor on the flat
 * price / row price, or a backend that accepts 0). Re-read the finding before
 * "fixing" the test.
 *
 * Fixture policy: read-only. Both scenarios end in a 400, so no batch is
 * persisted, no job is enqueued and no offer is created on any marketplace.
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

/** The wizard's own Resolve-step call; a card match is what makes a row ready unedited. */
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

/** Fill the destination's lazily-populated platform-config selects. */
async function completePlatformConfig(page: Page): Promise<void> {
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

/** Review CTA -> duplicate guard (if any) -> Confirm step -> submit, capturing the POST. */
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

/** Every message string in a Nest validation error body. */
function messagesOf(body: unknown): string[] {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.map(String);
  if (typeof message === 'string') return [message];
  return [JSON.stringify(body)];
}

/* ──────────────────────────────── the scenarios ─────────────────────────────── */

test.describe('F3: price 0 passes the wizard, then 400s the whole batch', () => {
  test('flat price 0 in the Config step: rows stay ready, submit 400s on price', async ({
    page,
    api,
    world,
  }, testInfo) => {
    const destination = pickBorrowsOfferDestination(world);
    test.skip(
      !destination,
      'No active OfferCreator connection without EanCategoryMatcher (a borrows-taxonomy ' +
        'destination such as Erli). Needed because its rows go `ready` without the operator ' +
        'filling required category parameters, isolating the price as the only submit gate.',
    );
    const connection = destination!;

    const { unlisted } = await findCandidates(api, connection.id);
    test.skip(
      unlisted.length === 0,
      `No priced, in-stock, barcoded variant that is NOT yet listed on "${connection.name}". ` +
        'An already-listed variant would be dropped by the already-listed filter (F2) and ' +
        'muddy which gate produced the 400. Sync a fresh product or list fewer variants.',
    );
    const candidate = unlisted[0];

    await openWizard(page, {
      productIds: [candidate.productId],
      variantIds: [candidate.variantId],
      connectionId: connection.id,
    });
    await completePlatformConfig(page);

    // (a1) The flat-price field takes a bare `0` - no floor, no error, and the
    // step's forward CTA stays enabled (its markup / cap / flat-stock siblings
    // all carry floors).
    await page
      .locator('label')
      .filter({ hasText: 'Flat price for all rows' })
      .locator('input[type="radio"]')
      .check();
    const flatPrice = page.getByLabel('Flat price (PLN)');
    await flatPrice.fill('0');
    await expect(flatPrice).toHaveValue('0');
    const proceed = page.getByRole('button', { name: /^Proceed/ });
    await expect(
      proceed,
      'the Config step should still let the operator continue with a zero flat price',
    ).toBeEnabled();
    expect(
      await page.locator('.form-field__error').allInnerTexts(),
      'no client-side error is raised for the zero price',
    ).toEqual([]);
    await proceed.click();

    // (a2) Every row is still `ready` and the submit CTA is enabled.
    const counts = await waitForReview(page);
    expect(counts.attention, 'a zero price is not a row blocker').toBe(0);
    expect(counts.ready).toBeGreaterThan(0);
    await expect(reviewCta(page)).toBeEnabled();

    // PROOF (documentation only - never asserted on): the promise.
    await captureProof(page, 'f03-before-review-ready', { region: reviewRegion(page) });

    // (b) The API rejects the whole request.
    const submitted = await submitFromReview(page);

    // PROOF (documentation only): the opaque 400 the confirm modal renders back.
    await captureProof(page, 'f03-before-result', {
      region: page.getByRole('dialog').filter({ has: page.locator('.alert--error') }),
      prepare: async () => {
        await expect(page.locator('.alert--error').first()).toBeVisible({ timeout: 15_000 });
      },
    });

    expect(
      submitted.requestBody,
      'the wizard really did send the zero price (it is not coerced away client-side)',
    ).toContain('"amount":0');
    expect(submitted.status, `request: ${submitted.requestBody}`).toBe(400);
    const messages = messagesOf(submitted.body);
    expect(
      messages.join(' | '),
      'the 400 blames the price - and says only "invalid value", with no field-level reason',
    ).toMatch(/price/i);

    testInfo.annotations.push({
      type: 'divergence',
      description: `wizard said ${counts.ready} ready with price 0; server replied 400 ${messages.join(' | ')}`,
    });
  });

  test('per-row price override of 0: the row editor saves it, submit 400s on price', async ({
    page,
    api,
    world,
    env,
  }, testInfo) => {
    // The per-row path writes into the SAME `perVariantOverrides[...].price`
    // slot, so it hits the same `@IsPositive()` gate. It is driven on a
    // taxonomy-owning destination because that is where the row editor has a
    // resolved category and can be saved.
    const destination = pickOwnsTaxonomyOfferDestination(world);
    test.skip(
      !destination,
      'No active OfferCreator connection advertising EanCategoryMatcher (a taxonomy-owning ' +
        'destination such as Allegro).',
    );
    const connection = destination!;
    const token = await bearerToken(env);

    const { listed, unlisted } = await findCandidates(api, connection.id);
    const all = [...unlisted, ...listed];
    const resolved = await resolveBatch(
      env,
      token,
      connection.id,
      all.map((row) => ({ variantId: row.variantId, ean: row.ean, sourceCategoryIds: ['2'] })),
    );
    const cardMatched = all.filter((row) => {
      const result = resolved[row.variantId];
      return result?.kind === 'matched' && !!result.productCardId;
    });
    test.skip(
      cardMatched.length === 0,
      `No priced, in-stock variant on "${connection.name}" whose barcode resolves to a ` +
        'marketplace product card. Without a card match the row carries a required-parameter ' +
        'blocker, so its readiness could not be asserted. Add a product whose EAN exists in the ' +
        "destination's catalogue (or list one there once, which creates the card).",
    );
    const candidate = cardMatched[0];

    await openWizard(page, {
      productIds: [candidate.productId],
      variantIds: [candidate.variantId],
      connectionId: connection.id,
    });
    await completePlatformConfig(page);
    await page.getByRole('button', { name: /^Proceed/ }).click();
    await waitForReview(page);

    // Open the row editor and set this row's price to 0. The editor renders two
    // shapes: a multi-variant product gets a "Price policy" select (whose `flat`
    // option reveals a price field), a simple product gets a direct "Price" field.
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    const editor = page.getByRole('dialog').first();
    await expect(editor.getByRole('button', { name: 'Save all' })).toBeVisible({ timeout: 20_000 });
    const pricePolicy = editor.getByLabel('Price policy');
    let rowPrice: Locator;
    if (await pricePolicy.count()) {
      await pricePolicy.selectOption('flat');
      rowPrice = editor.getByLabel(/Flat price/);
    } else {
      rowPrice = editor.getByLabel('Price', { exact: true });
    }
    // Write a non-zero value first so the zero is a real change (a flat-price
    // field defaults to "0", and an unchanged field would not be persisted).
    await rowPrice.fill('12.34');
    await rowPrice.fill('0');
    expect(
      await editor.locator('.form-field__error').allInnerTexts(),
      'the row editor raises no error for a zero price',
    ).toEqual([]);
    await editor.getByRole('button', { name: 'Save all' }).click();
    await expect(editor, 'the row editor accepts and saves the zero price').toBeHidden({
      timeout: 20_000,
    });

    // (a) The row is still ready after the zero-price override.
    const counts = await waitForReview(page);
    expect(counts.attention, 'a zero per-row price is not a row blocker').toBe(0);
    expect(counts.ready).toBeGreaterThan(0);
    await expect(reviewCta(page)).toBeEnabled();

    // (b) The whole request 400s on that one row's price.
    const submitted = await submitFromReview(page);
    expect(submitted.requestBody).toContain('"amount":0');
    expect(submitted.status, `request: ${submitted.requestBody}`).toBe(400);
    const messages = messagesOf(submitted.body);
    expect(
      messages.join(' | '),
      'the per-row zero price is reported as an opaque "invalid value" on the override map',
    ).toMatch(/price: invalid value/i);

    testInfo.annotations.push({
      type: 'divergence',
      description: `row editor saved price 0 and kept the row ready; server replied 400 ${messages.join(' | ')}`,
    });
  });
});
