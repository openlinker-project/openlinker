/**
 * F6 - Erli images: the wizard counts strings, the adapter demands public https,
 * and the record that loses that argument never terminates
 *
 * ⚠️ CHARACTERIZATION TEST. It passes **while the divergence exists** and goes RED
 * once it is closed. A failure here is NOT a regression - it means the finding was
 * wrong, or it has been fixed and this file should be retired (or inverted into a
 * normal regression test).
 *
 * The divergence has two independent halves, and BOTH are asserted:
 *
 *   (a) THE WIZARD SAYS READY. `bulk-policy.ts` `imageCountForVariant` /
 *       `imageCountForRow` count any NON-EMPTY STRING - zero protocol
 *       validation - and that count is the only input the Erli plugin's
 *       `erli:missing-image` blocker consumes. So a row whose entire image set
 *       is `http://…` reads `ready`, the readiness summary reports 0 needing
 *       attention, and the submit CTA is enabled. The row editor's "Add image"
 *       field applies no URL-shape validation either: the image array is held in
 *       component state outside react-hook-form, and `makeBulkEditModalSchema`
 *       has no `imageUrls` member at all - so `baseForm.trigger()` (the editor's
 *       only save gate) cannot see it. Contrast `categoryId`, which that schema
 *       DOES require and which does block the save.
 *
 *   (b) THE RECORD NEVER TERMINATES. `ErliOfferManagerAdapter.sanitizeImageUrls`
 *       FILTERS rather than rejects - every URL failing `isSafePublicHttpsUrl`
 *       (non-https, localhost/`.internal`, RFC1918, IPv6 ULA/link-local,
 *       169.254.169.254) is dropped with a `logger.warn` - and `resolveImages`
 *       throws `ErliConfigException` only when ZERO survive. That exception
 *       `extends Error` and is classified by NEITHER
 *       `offer-creation-execution.service.ts` (whose adapter-call catch only
 *       narrows `OfferCreateRejectedException`) NOR `mapBuilderException`. So it
 *       is rethrown past the record, `advanceBatchStatus` is never reached, and:
 *         - the `OfferCreationRecord` stays `pending` with `errors: null`,
 *         - the parent batch stays `running` - `succeededCount + failedCount`
 *           can never reach `totalCount`, so no terminal status is derivable,
 *         - the batch-progress row renders "Queued", forever.
 *       `ErliRetryClassifierAdapter` marks `ErliConfigException` non-retryable,
 *       so the job is marked `dead` on the FIRST attempt and the only readable
 *       reason lands in `sync_jobs.lastError` - a place the batch view, the
 *       record, and the operator never look.
 *
 * Test 3 covers the SEPARATE, quieter case from the same mechanism: when SOME
 * images survive sanitisation the gate stays silent and the offer goes out with a
 * shortened gallery, with no signal anywhere. Proving that WITHOUT creating a real
 * marketplace product needs a trick: `buildCreateBody` calls `resolveImages`
 * BEFORE `resolveDispatchTime`, so a partially-unsafe image set plus a
 * deliberately-malformed `dispatchTime` fails on the DISPATCH TIME. The image that
 * was silently dropped is never mentioned by anything the operator can read - which
 * is exactly the claim - and no offer reaches Erli. (What this cannot show
 * end-to-end is the shortened gallery on a LIVE offer; asserting that would mean
 * publishing a real sandbox product and permanently consuming the fixture variant.)
 *
 * GETTING PAST THE EARLIER GATES. An Erli row dies on F10
 * (`overrides.categoryId` / `REQUIRED`) and then F1 (`parameters.Stan` /
 * `PARAMETER_REQUIRED`) long before the adapter is reached, so tests 2 and 3
 * submit through the raw API with a resolved `categoryId` + the category's
 * required offer-section parameters supplied - exactly the shape an operator gets
 * after filling the row editor, and the same manoeuvre F5 needed to see past F1.
 * That in turn requires a stack whose `PerOverrideDto.overrides` still accepts
 * `categoryId` (#1924); on a stack that still ships `OverridesNoCategoryDto` the
 * submit 400s and the tests self-skip with the recipe rather than assert the
 * wrong failure.
 *
 * Test 1 is the browser half and needs the unsafe URL to reach the row's override,
 * which means saving the row editor - so it also picks a category there, because
 * that IS a hard save gate on this destination. That pick is a precondition, not
 * part of the claim; it makes the assertion strictly stronger, since the row is
 * then as complete as the wizard is capable of asking for and STILL says nothing
 * about the images.
 *
 * FOOTPRINT. The finding IS "the batch never terminates", so tests 2 and 3 each
 * leave one permanently-`running` batch with a `pending` record behind on the
 * stack; test 1 aborts its POST and leaves nothing. No Erli product is ever
 * created and no offer mapping is written, so the fixture variant stays reusable
 * by the next run. Every leftover is annotated.
 *
 * @module tests/preflight-divergence
 */
import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Connection, Product, ProductVariant, SyncJob } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import type { World } from '../../src/world/world';
import { captureProof, reviewRegion } from './__proof__/capture';

test.describe.configure({ mode: 'serial' });

/**
 * A syntactically valid URL that `class-validator`'s `@IsUrl` accepts (so the
 * request DTO lets it through) and `isSafePublicHttpsUrl` rejects on protocol
 * alone. Deliberately NOT a localhost/RFC1918 host: the point is that the plain
 * `http://` scheme - the shape a shop serves before its TLS terminator is wired -
 * is enough, so this is not an exotic edge case.
 */
const UNSAFE_IMAGE_URL = 'http://example.com/openlinker-e2e-f6-unsafe.jpg';

/** Batch statuses that mean "this batch will never move again". */
const TERMINAL_BATCH_STATUSES = new Set(['completed', 'partially-failed', 'failed']);

/**
 * How long to keep watching after the worker has already given up. The job dies
 * within a couple of seconds of enqueue; this is the settle window in which a
 * healthy pipeline would have terminated the record and the batch.
 */
const STUCK_OBSERVATION_MS = 25_000;

/** `BulkBatchRecordSummaryDto.errors` - on the wire, absent from the shared type. */
interface RecordError {
  field?: string | null;
  code: string;
  message: string;
}

interface BatchRecord {
  id: string;
  internalVariantId: string;
  status: string;
  externalOfferId: string | null;
  errors?: RecordError[] | null;
}

interface BatchWithErrors {
  id: string;
  status: string;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  records: BatchRecord[];
}

/** Per-variant override entry of `POST /listings/bulk-create`. */
interface BulkOverride {
  stock?: number;
  publishImmediately?: boolean;
  price?: { amount: number; currency: string };
  overrides?: Record<string, unknown>;
}

interface BulkCreateBody {
  connectionId: string;
  productIds: string[];
  sharedConfig: { stock: number; publishImmediately: boolean };
  perProductOverrides?: Record<string, BulkOverride>;
  perVariantOverrides?: Record<string, BulkOverride>;
  excludedVariantIds?: string[];
}

/** The fixture both the browser half and the API half run against. */
interface Fixture {
  product: Product;
  variant: ProductVariant;
  /** Master image URLs that DO survive `isSafePublicHttpsUrl` (test 3 needs one). */
  safeImages: string[];
  /** A category the Erli connection can read parameters for (clears F10's gate). */
  categoryId: string;
  /** That category's required `section: 'offer'` parameter ids (clears F1's gate). */
  requiredOfferParamIds: string[];
}

/** Resolved once by test 1 and replayed by tests 2 and 3 (serial describe). */
let fixture: Fixture | null = null;
let erliConnection: Connection | null = null;

/* ─────────────────────────────── raw API helpers ────────────────────────────── */

async function bearer(env: E2eEnv): Promise<string> {
  const response = await fetch(`${env.apiUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.adminUser, password: env.adminPass }),
  });
  if (!response.ok) {
    throw new Error(`E2E login failed: HTTP ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { access_token: string }).access_token;
}

/**
 * Raw `POST /listings/bulk-create`. The node `ApiClient` exposes no bulk-submit
 * method and this suite must not modify `src/`, so the call is issued here.
 * Returns status + parsed body rather than throwing, because a 400 is one of the
 * outcomes this spec has to READ (it is the "stack predates #1924" skip signal).
 */
async function submitBulkCreate(
  env: E2eEnv,
  body: BulkCreateBody,
): Promise<{ status: number; body: unknown; raw: string }> {
  const token = await bearer(env);
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
  return { status: response.status, body: parsed, raw };
}

/** Raw read - the shared `BulkBatchSummary` type omits the per-record `errors[]`. */
async function getBatch(env: E2eEnv, batchId: string): Promise<BatchWithErrors> {
  const token = await bearer(env);
  const response = await fetch(`${env.apiUrl}/v1/listings/bulk-create/${batchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET bulk-create/${batchId} -> HTTP ${response.status}`);
  }
  return (await response.json()) as BatchWithErrors;
}

/**
 * The `marketplace.offer.create` job the bulk submit enqueued for one variant.
 * Keyed on the batch-scoped idempotency key `BulkListingSubmitService` mints, so
 * a concurrent batch on the same connection cannot be mistaken for this one.
 */
async function findChildJob(
  api: ApiClient,
  connectionId: string,
  batchId: string,
  variantId: string,
): Promise<SyncJob | undefined> {
  const page = await api.syncJobs.list({
    connectionId,
    jobType: 'marketplace.offer.create',
    limit: 100,
  });
  const key = `bulk:${batchId}:variant:${variantId}`;
  return page.items.find((job) => job.idempotencyKey === key);
}

/* ────────────────────────── local fixture discovery ─────────────────────────── */

/** Mirror of `isSafePublicHttpsUrl` - which master images the adapter would keep. */
function isSafePublicHttps(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.internal') || host === '169.254.169.254') return false;
  if (host === '[::1]' || host === '[::]' || /^\[f[cd]/.test(host) || /^\[fe[89ab]/.test(host)) {
    return false;
  }
  if (host === '0.0.0.0' || /^(127|10)\./.test(host) || /^192\.168\./.test(host)) return false;
  return !/^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function productImages(product: Product): string[] {
  const images = (product as unknown as { images?: unknown }).images;
  return Array.isArray(images) ? images.filter((u): u is string => typeof u === 'string') : [];
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
 * A row that reaches Review green on Erli and can be pushed all the way to the
 * adapter. Each condition closes a way the run could land on a DIFFERENT finding:
 *
 *   1. Single-variant     - keeps the fan-out at one job, so "the batch never
 *                           terminates" is about ONE record, not a partial batch.
 *   2. Not already listed - `filterAlreadyListed` would drop it and the submit
 *                           would die on F2's empty-batch path instead.
 *   3. Priced + stocked   - otherwise the wizard flags the row for the wrong
 *                           reason and the readiness assertion is meaningless.
 *   4. Carries a barcode  - `enforceIdentifierRules` runs at submit.
 *   5. At least one image that WOULD survive sanitisation - test 3's mixed set
 *      needs a genuine survivor, and test 1's "remove the master images" step
 *      only means something if there were safe ones to remove.
 */
async function findFixtureCandidate(
  api: ApiClient,
  world: World,
  connectionId: string,
): Promise<{ product: Product; variant: ProductVariant; safeImages: string[] } | null> {
  const listed = await listedVariantIds(api, connectionId);
  for (const summary of await world.listProducts(100)) {
    const product = await api.products.getById(summary.id);
    const variants = product.variants ?? [];
    if (variants.length !== 1) continue;
    const [variant] = variants;
    if (listed.has(variant.id)) continue;
    if (product.price === null || product.price <= 0) continue;
    if ((variant.ean ?? variant.gtin ?? null) === null) continue;
    const safeImages = productImages(product).filter(isSafePublicHttps);
    if (safeImages.length === 0) continue;
    const availability = await api.inventory.availability([variant.id]);
    if ((availability[0]?.totalAvailable ?? 0) <= 0) continue;
    return { product, variant, safeImages };
  }
  return null;
}

/**
 * A category the Erli connection can actually read parameters for, plus that
 * category's required offer-section parameter ids. Erli borrows Allegro's
 * taxonomy (#1045), so the probe category is the same `E2E_FRESH_ALLEGRO_CATEGORY_ID`
 * the rest of the suite pins; a non-empty parameter list also proves the
 * duck-typed catalogue client is attached (i.e. F10's gate is armed and the
 * `categoryId` override is genuinely required).
 */
async function resolveCategoryGate(
  api: ApiClient,
  connectionId: string,
  categoryId: string,
): Promise<{ categoryId: string; requiredOfferParamIds: string[] } | null> {
  try {
    const parameters = await api.listings.categoryParameters(connectionId, categoryId);
    if (parameters.length === 0) return null;
    return {
      categoryId,
      requiredOfferParamIds: parameters
        .filter((parameter) => parameter.required && parameter.section === 'offer')
        .map((parameter) => parameter.id),
    };
  } catch {
    return null;
  }
}

/** The overrides block that clears F10 (category) and F1 (offer parameters). */
function gateClearingOverrides(current: Fixture): Record<string, unknown> {
  return {
    categoryId: current.categoryId,
    parameters: current.requiredOfferParamIds.map((id) => ({
      id,
      values: ['1'],
      section: 'offer',
    })),
  };
}

/* ─────────────────────────────── wizard driving ─────────────────────────────── */

/**
 * The Review step's submit CTA, tolerant of both label generations ("Approve all
 * (N)" on the build the shared page object was written against, "Create offers
 * (N)" on the current one). The `(N)` suffix is what keeps it from also matching
 * the confirm modal's own bare "Create offers" button.
 */
function submitCta(page: Page): Locator {
  return page.getByRole('button', { name: /^(Approve all|Create offers)\s*\(\d+\)$/ }).first();
}

/**
 * Read the Review step's readiness counters off its `role="status"` summary. The
 * shared page object's `needsAttentionCount()` parses the FIRST number of the
 * current "N ready · M need attention · K excluded" phrasing, i.e. it returns the
 * READY count and fails open. Anchor on the labelled number instead.
 */
async function readinessCounts(
  page: Page,
): Promise<{ ready: number; needAttention: number; raw: string }> {
  const hint = page.getByRole('status').filter({ hasText: /needs? attention/ }).first();
  if ((await hint.count()) === 0) return { ready: 0, needAttention: 0, raw: '(no readiness hint)' };
  const raw = (await hint.innerText()).replace(/\s+/g, ' ').trim();
  const attention = /(\d+)\s+needs?\s+attention/i.exec(raw);
  const ready = /(\d+)\s+ready/i.exec(raw);
  return { ready: ready ? Number(ready[1]) : 0, needAttention: attention ? Number(attention[1]) : 0, raw };
}

/**
 * Wait until the Review step has SETTLED - the async per-category parameter
 * schema has resolved and the row blockers reflect it - so a transient
 * "0 need attention, submit disabled" limbo is never read as readiness.
 */
async function waitForReviewSettled(page: Page): Promise<void> {
  await expect(async () => {
    const cta = submitCta(page);
    if ((await cta.count()) === 0) throw new Error('Review step has not rendered its submit CTA.');
    const [enabled, counts] = await Promise.all([cta.isEnabled(), readinessCounts(page)]);
    if (!enabled && counts.needAttention === 0) {
      throw new Error(`Review still resolving: submit disabled with no needs-attention rows (${counts.raw}).`);
    }
  }).toPass({ timeout: 60_000 });
}

/**
 * Pick the destination on the Config step. The step renders a grouped RADIO RAIL
 * when more than one publish destination exists and a plain alert when there is
 * only one; the shared page object only covers the older `<select>` layout.
 */
async function selectDestination(page: Page, name: string): Promise<void> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const radio = page.getByRole('radio', { name: new RegExp(escaped) });
  if ((await radio.count()) > 0) {
    await radio.first().click();
    return;
  }
  const select = page.locator('select#bulk-connection');
  if ((await select.count()) > 0) await select.selectOption({ label: name });
}

/**
 * Satisfy the row editor's ONLY hard save gate - the category. This Erli
 * connection duck-types `fetchCategories`, so `makeBulkEditModalSchema` is built
 * with `requireCategory: true` and `baseForm.trigger()` refuses to save while
 * `categoryId` is blank ("Category is required" ▲ next to the crumb). Nothing
 * comparable exists for the image set, which is the point: the editor blocks on
 * the field it can validate and waves through the one it cannot.
 *
 * Drills `E2E_FRESH_ALLEGRO_CATEGORY_PATH` in the nested `BulkCategoryChooseModal`
 * (non-leaf rows expose "Browse into {name}", leaves a "Select" button).
 */
async function pickCategoryIfRequired(page: Page, editor: Locator, path: string[]): Promise<void> {
  if ((await editor.getByRole('img', { name: 'Category is required' }).count()) === 0) return;
  await editor.getByRole('button', { name: 'Change category' }).first().click();

  const picker = page.locator('.bulk-editor__catpick');
  await expect(picker.getByLabel('Search categories')).toBeVisible({ timeout: 30_000 });
  for (let depth = 0; depth < path.length; depth += 1) {
    const name = path[depth];
    const row = picker
      .locator('li.bulk-editor__catpick-item')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first();
    await expect(row, `category node "${name}" (depth ${depth}) is listed`).toBeVisible({
      timeout: 30_000,
    });
    if (depth === path.length - 1) {
      await row.getByRole('button', { name: /^Select(ed)?$/ }).click();
      break;
    }
    await row.getByRole('button', { name: `Browse into ${name}` }).click();
    await expect(picker.getByText('Fetching categories')).toHaveCount(0, { timeout: 30_000 });
  }
  await expect(picker).toHaveCount(0, { timeout: 20_000 });
  await expect(
    editor.getByRole('img', { name: 'Category is required' }),
    'the category the editor demanded is now set',
  ).toHaveCount(0, { timeout: 20_000 });
}

/**
 * Replace the row's whole image set with one `http://` URL, through the row
 * editor an operator actually uses. `bulk-edit-modal.tsx` renders the image
 * strip as a "Remove image" (`×`) button per thumbnail plus an "Add image"
 * (`＋`) control that reveals a "New image URL" field committed by an "Add"
 * button. Not one of those steps validates the URL's shape - the array lives in
 * component state, outside the form the save gate validates.
 */
async function replaceImagesWithUnsafeUrl(page: Page, categoryPath: string[]): Promise<void> {
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const editor = page.getByRole('dialog').first();
  await expect(editor.getByRole('button', { name: 'Save all' })).toBeVisible({ timeout: 30_000 });
  await pickCategoryIfRequired(page, editor, categoryPath);

  // Strip the master set one thumbnail at a time. The `×` is `display: none`
  // until its thumb is hovered (`.bulk-editor__img-strip--editable
  // .bulk-editor__img-thumb:hover .bulk-editor__img-x`), so each removal is
  // hover-then-click, and each is awaited before the next (the strip re-renders
  // per change, so a blind click loop overshoots).
  const thumbs = editor.locator('.bulk-editor__img-strip--editable .bulk-editor__img-thumb');
  for (let remaining = await thumbs.count(); remaining > 0; remaining -= 1) {
    const thumb = thumbs.first();
    await thumb.hover();
    await thumb.getByRole('button', { name: 'Remove image' }).click();
    await expect(thumbs).toHaveCount(remaining - 1, { timeout: 15_000 });
  }

  await editor.getByRole('button', { name: 'Add image' }).first().click();
  await editor.getByLabel('New image URL').first().fill(UNSAFE_IMAGE_URL);
  await editor.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(
    thumbs,
    'exactly one image (the unsafe URL) survives in the editor',
  ).toHaveCount(1, { timeout: 15_000 });

  await editor.getByRole('button', { name: 'Save all' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
}

/* ──────────────────────────────── the scenario ──────────────────────────────── */

test.describe('F6 - Erli image sanitisation vs the wizard string count', () => {
  test('(a) an all-http image set reads READY and the wizard submits it verbatim', async ({
    env,
    api,
    world,
    page,
  }, testInfo) => {
    // Fixture resolution walks the catalogue (product detail + availability per
    // candidate) and the wizard round-trips the category-parameter schema, both
    // well past the suite's default per-test budget.
    test.setTimeout(300_000);

    const erli = world.connectionsFor('erli').find((connection) => connection.status === 'active');
    test.skip(
      !erli,
      'No usable fixture: this stack has no ACTIVE Erli connection. F6 is triggered by ' +
        "`ErliOfferManagerAdapter`'s image sanitisation, so it needs an Erli publish destination " +
        '(Connections -> Add -> Erli, with an API key and `defaultDispatchTime` configured).',
    );
    erliConnection = erli!;

    const gate = await resolveCategoryGate(api, erli!.id, env.freshAllegroCategoryId);
    test.skip(
      gate === null,
      'No usable fixture: the Erli connection cannot read category parameters for ' +
        `${env.freshAllegroCategoryId}, so tests 2/3 could not clear F10's ` +
        '`overrides.categoryId / REQUIRED` gate and would assert the wrong failure. Give the Erli ' +
        'connection Allegro category credentials (allegroClientId + allegroClientSecret), or ' +
        'override the probe category with E2E_FRESH_ALLEGRO_CATEGORY_ID.',
    );

    const candidate = await findFixtureCandidate(api, world, erli!.id);
    test.skip(
      candidate === null,
      'No usable fixture: this stack has no master product that is (a) single-variant, (b) not ' +
        'yet listed on the Erli connection, (c) priced, stocked and carrying a barcode, and ' +
        '(d) carrying at least one image URL that WOULD pass `isSafePublicHttpsUrl` (public ' +
        'https host). Point the master shop\'s `config.storefrontBaseUrl` at an https tunnel and ' +
        're-run master.product.syncAll + master.inventory.syncAll.',
    );

    fixture = { ...candidate!, ...gate! };

    expect(
      fixture.safeImages.length,
      'fixture sanity: the master images the wizard counts are genuinely SAFE ones, so any ' +
        'divergence observed below comes from the operator-supplied URL and not from the stack ' +
        'happening to serve its catalogue over http',
    ).toBeGreaterThan(0);

    const query = new URLSearchParams({
      productIds: fixture.product.id,
      variantIds: fixture.variant.id,
      connectionId: erli!.id,
    });
    await page.goto(`/listings/bulk-create/wizard?${query.toString()}`);
    await expect(page.getByRole('heading', { name: 'Bulk marketplace offer creation' })).toBeVisible({
      timeout: 30_000,
    });
    await selectDestination(page, erli!.name);

    // Erli's buyability selects (delivery price list + responsible producer) are
    // the config step's only platform gate; the image set is not asked about here
    // either, which is the finding restated one step earlier.
    const proceed = page.getByRole('button', { name: /^Proceed/ });
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
      expect(await proceed.isEnabled(), 'the Config step "Proceed" CTA should unlock').toBe(true);
    }).toPass({ timeout: 90_000 });
    await proceed.click();

    await expect(submitCta(page)).toBeVisible({ timeout: 60_000 });
    await waitForReviewSettled(page);
    await replaceImagesWithUnsafeUrl(page, env.freshAllegroCategoryPath);
    await waitForReviewSettled(page);

    const counts = await readinessCounts(page);
    expect(
      counts.needAttention,
      `an image set the destination adapter will reject IN FULL raises no blocker: ${counts.raw}`,
    ).toBe(0);
    expect(counts.ready, `the row is counted ready: ${counts.raw}`).toBeGreaterThan(0);
    await expect(
      submitCta(page),
      'the wizard enables submit - `imageCountForVariant` counted one non-empty string and stopped',
    ).toBeEnabled();

    // PROOF (documentation only - never asserted on): the promise.
    await captureProof(page, 'f06-before-review-ready', { region: reviewRegion(page) });

    // Capture the body the wizard actually builds, then ABORT at the network
    // layer: submitting it here would die on F10's category gate (a different
    // finding). Test 2 replays this shape with the category + parameters added.
    let captured: string | null = null;
    await page.route('**/listings/bulk-create', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      captured = route.request().postData();
      await route.abort();
    });

    await submitCta(page).click();
    const dialog = page.getByRole('dialog');
    const publishAnyway = dialog.getByRole('button', { name: /Publish anyway/ });
    if (await publishAnyway.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await publishAnyway.click();
    }
    const confirm = page.getByRole('button', { name: 'Create offers', exact: true });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    const publishToggle = page.getByRole('checkbox', { name: /Publish immediately/ });
    if ((await publishToggle.count()) > 0) await publishToggle.uncheck();
    await confirm.click();

    await expect(async () => {
      expect(captured, 'the wizard issued its POST /listings/bulk-create').not.toBeNull();
    }).toPass({ timeout: 30_000 });
    await page.unroute('**/listings/bulk-create');

    const body = JSON.parse(captured!) as BulkCreateBody;
    const emitted = [
      ...Object.values(body.perVariantOverrides ?? {}),
      ...Object.values(body.perProductOverrides ?? {}),
    ]
      .map((override) => override.overrides?.imageUrls)
      .find((urls): urls is string[] => Array.isArray(urls));
    expect(
      emitted,
      `the wizard forwards the operator's image set untouched: ${captured}`,
    ).toContain(UNSAFE_IMAGE_URL);
    expect(
      emitted,
      'and it is the ONLY image - nothing on the client re-added a usable one',
    ).toHaveLength(1);

    testInfo.annotations.push({
      type: 'divergence',
      description:
        `wizard readiness with an all-http image set: ${counts.raw}; emitted imageUrls=${JSON.stringify(emitted)}`,
    });
  });

  test('(b) the record never terminates: pending forever, batch stuck running, reason only in sync_jobs', async ({
    env,
    api,
    page,
    poll,
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(fixture === null || erliConnection === null, 'depends on the fixture resolved above.');
    const current = fixture!;
    const connection = erliConnection!;

    const result = await submitBulkCreate(env, {
      connectionId: connection.id,
      productIds: [current.variant.id],
      sharedConfig: { stock: 1, publishImmediately: false },
      perVariantOverrides: {
        [current.variant.id]: {
          overrides: {
            ...gateClearingOverrides(current),
            imageUrls: [UNSAFE_IMAGE_URL],
            platformParams: { dispatchTime: { period: 2, unit: 'day' } },
          },
        },
      },
      excludedVariantIds: [],
    });
    test.skip(
      result.status === 400,
      'This stack rejects a per-variant `overrides.categoryId` (`PerVariantOverrideDto.overrides` ' +
        'is still `OverridesNoCategoryDto`, i.e. it predates #1924/PR #1930). Without it the row ' +
        "dies on F10's `overrides.categoryId / REQUIRED` in the builder and never reaches the Erli " +
        'adapter, so F6 cannot be observed here. Run this spec against a stack carrying #1924. ' +
        `Server said: ${result.raw}`,
    );
    expect(
      result.status,
      `the submit is accepted - nothing on the request path measures an image URL: ${result.raw}`,
    ).toBe(202);
    const batchId = (result.body as { batchId?: string }).batchId ?? null;
    expect(batchId, 'the accept response carries a batchId').toBeTruthy();

    // The worker consumed the job and gave up. `ErliRetryClassifierAdapter` marks
    // `ErliConfigException` non-retryable, so this is `dead` on the first attempt
    // - there is no pending retry that could still terminate the record.
    const job = await poll.until(
      () => findChildJob(api, connection.id, batchId!, current.variant.id),
      (candidate) => candidate !== undefined && candidate.status === 'dead',
      {
        timeoutMs: 120_000,
        intervalMs: 3_000,
        message: `the marketplace.offer.create job for batch ${batchId} to be marked dead`,
      },
    );
    expect(
      job!.attempts,
      'non-retryable: the job is buried on attempt 1, so nothing will revisit the record',
    ).toBeLessThanOrEqual(1);
    expect(
      job!.lastError ?? '',
      'the ONLY readable reason - and it lives in sync_jobs, which the batch view never reads',
    ).toMatch(/image/i);

    // …and the record + batch are frozen. Watched past the point where a healthy
    // pipeline would have terminated both.
    const deadline = Date.now() + STUCK_OBSERVATION_MS;
    let batch = await getBatch(env, batchId!);
    while (Date.now() < deadline) {
      batch = await getBatch(env, batchId!);
      expect(
        TERMINAL_BATCH_STATUSES.has(batch.status),
        `the batch must NOT terminate - advanceBatchStatus is unreachable. Observed: ${batch.status}`,
      ).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    expect(batch.records.length, 'the batch has exactly one child').toBe(1);
    const [record] = batch.records;
    expect(
      record.status,
      'the record is still `pending` long after the job was buried: the rethrown ' +
        'ErliConfigException never reached `updateStatus`',
    ).toBe('pending');
    expect(
      record.errors ?? null,
      'and it carries NO structured error - the operator has nothing to read',
    ).toBeNull();
    expect(record.externalOfferId, 'no Erli product was created').toBeNull();
    expect(
      batch.succeededCount + batch.failedCount,
      'the #737 counter gate can never fire: neither counter ever moves',
    ).toBe(0);
    expect(batch.totalCount).toBe(1);

    // What the operator actually sees.
    await page.goto(`/listings/bulk-batches/${batchId!}`);
    await expect(
      page.getByText('Queued', { exact: true }).first(),
      'the batch-progress row reads "Queued" - indistinguishable from a job that has not run yet',
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator('button[aria-label^="Failure details for"]'),
      'no failure-details affordance is offered, because the record never failed',
    ).toHaveCount(0);
    await expect(
      page.locator('.bulk-batch__err'),
      'and no inline reason is rendered anywhere on the row',
    ).toHaveCount(0);

    // PROOF (documentation only): the batch that can never terminate - the row
    // still reads "Queued" long after the job was buried.
    await captureProof(page, 'f06-before-result', { fullPage: true });

    testInfo.annotations.push({
      type: 'fixture',
      description:
        `left behind (this IS the finding): batch ${batchId} permanently \`${batch.status}\` with ` +
        `record ${record.id} \`pending\`; job ${job!.id} dead: ${job!.lastError ?? ''}`,
    });
  });

  test('(c) silent truncation: a partially-unsafe set is quietly shortened, and nothing says so', async ({
    env,
    api,
    poll,
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(fixture === null || erliConnection === null, 'depends on the fixture resolved above.');
    const current = fixture!;
    const connection = erliConnection!;

    // One survivor + one casualty. `sanitizeImageUrls` drops the http entry with a
    // `logger.warn` and `resolveImages` does NOT throw, so the create proceeds
    // with a gallery the operator never agreed to. The malformed dispatchTime -
    // read AFTER the images in `buildCreateBody` - stops the request at the next
    // step, so nothing is ever published: the failure that DOES surface is the
    // proof that the image gate stayed silent.
    const result = await submitBulkCreate(env, {
      connectionId: connection.id,
      productIds: [current.variant.id],
      sharedConfig: { stock: 1, publishImmediately: false },
      perVariantOverrides: {
        [current.variant.id]: {
          overrides: {
            ...gateClearingOverrides(current),
            imageUrls: [current.safeImages[0], UNSAFE_IMAGE_URL],
            platformParams: { dispatchTime: { period: -1, unit: 'day' } },
          },
        },
      },
      excludedVariantIds: [],
    });
    test.skip(
      result.status === 400,
      'This stack rejects a per-variant `overrides.categoryId` (predates #1924/PR #1930) - see ' +
        `the skip message on the previous test. Server said: ${result.raw}`,
    );
    expect(result.status, `submit accepted: ${result.raw}`).toBe(202);
    const batchId = (result.body as { batchId?: string }).batchId ?? null;
    expect(batchId, 'the accept response carries a batchId').toBeTruthy();

    const job = await poll.until(
      () => findChildJob(api, connection.id, batchId!, current.variant.id),
      (candidate) => candidate !== undefined && candidate.status === 'dead',
      {
        timeoutMs: 120_000,
        intervalMs: 3_000,
        message: `the marketplace.offer.create job for batch ${batchId} to be marked dead`,
      },
    );
    const lastError = job!.lastError ?? '';
    expect(
      lastError,
      'the create got PAST the image gate with one of two images silently discarded, and stopped ' +
        `on the very next field it reads. Observed: ${lastError}`,
    ).toMatch(/dispatchTime/i);
    expect(
      lastError,
      'nothing anywhere mentions the dropped image - the only trace is a worker-log `logger.warn` ' +
        'that no API, record or screen surfaces',
    ).not.toMatch(/image/i);

    const batch = await getBatch(env, batchId!);
    expect(
      TERMINAL_BATCH_STATUSES.has(batch.status),
      `same non-termination as (b) - every ErliConfigException takes this path. Observed: ${batch.status}`,
    ).toBe(false);
    const [record] = batch.records;
    expect(record.status, 'the record is still pending').toBe('pending');
    expect(record.errors ?? null, 'still no structured error for the operator').toBeNull();
    expect(record.externalOfferId, 'nothing was published, so no gallery was truncated for real').toBeNull();

    testInfo.annotations.push({
      type: 'divergence',
      description:
        `2 image URLs submitted, 1 survives sanitisation; the create proceeded and failed on the ` +
        `NEXT field instead: "${lastError}". Batch ${batchId} left \`${batch.status}\`.`,
    });
  });
});
