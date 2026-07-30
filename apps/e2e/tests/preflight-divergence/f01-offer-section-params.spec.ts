/**
 * F1 - the wizard only ever checks `section: 'product'` required parameters
 *
 * ⚠️ CHARACTERIZATION TEST. This spec passes **while the divergence exists** and
 * goes RED once it is closed. A failure here is NOT a regression - it means the
 * finding was wrong, or it has been fixed and this file should be retired (or
 * inverted into a normal regression test).
 *
 * The divergence: the backend's second offer-build gate
 * (`OfferBuilderService.buildOfferParameters`) rejects an offer whose category
 * has an unresolved REQUIRED parameter in the **offer** section -
 * `PARAMETER_REQUIRED` on e.g. `parameters.Stan` (id 11323). The wizard's
 * readiness computation never looks at that section:
 * `use-bulk-required-product-params.ts` filters
 * `p.required && p.section === 'product' && !p.dependsOn`, and that set is the
 * ONLY input to the `allegro:needs-product-parameters` blocker. The two sets are
 * disjoint, so a row whose offer-section parameters are entirely unsupplied is
 * rendered `ready`.
 *
 * The failure lands on a row the operator never opens. A row that IS edited is
 * safe by accident: the edit modal fetches the schema itself and renders EVERY
 * section, so filling it satisfies the gate. The regression came in with #1754
 * (5fa88bbe), which removed the single-offer wizard - the only surface that
 * hard-gated submit on the full parameter schema AND auto-prefilled `Stan`.
 *
 * The test asserts BOTH sides:
 *   (a) the wizard shows the row ready and enables submit, with no editor
 *       opened, and the submitted override carries no value for the required
 *       offer-section parameter, AND
 *   (b) the batch is accepted (202) and its child record terminates `failed`
 *       with `PARAMETER_REQUIRED` on that exact parameter.
 *
 * @module tests/preflight-divergence
 */
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { CategoryParameter, Connection, Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import type { World } from '../../src/world/world';
import type { BulkOfferWizard } from '../../src/pages/bulk-offer-wizard.page';
import type { Poller } from '../../src/support/poller';
import { captureProof, reviewRegion } from './__proof__/capture';

/** Terminal batch statuses (mirror of `BulkBatchStatus`). */
const TERMINAL_BATCH_STATUSES = new Set(['completed', 'partially-failed', 'failed']);

/** `BulkBatchRecordSummaryDto.errors` - on the wire, absent from the shared local type. */
interface RecordError {
  field?: string | null;
  code: string;
  message: string;
}

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

interface EanMatchLike {
  kind: string;
  allegroCategoryId?: string | null;
  productCardId?: string | null;
}

/** Run the wizard's own Resolve-step query for one variant. */
async function resolveCategory(
  env: E2eEnv,
  token: string,
  connectionId: string,
  variant: ProductVariant,
  sourceCategoryIds: string[],
): Promise<EanMatchLike | undefined> {
  const response = await fetch(
    `${env.apiUrl}/v1/listings/connections/${connectionId}/categories/resolve-batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: [
          {
            variantId: variant.id,
            ean: variant.ean ?? variant.gtin ?? null,
            ...(sourceCategoryIds.length > 0 ? { sourceCategoryIds } : {}),
          },
        ],
      }),
    },
  );
  if (!response.ok) return undefined;
  const body = (await response.json()) as { results?: Record<string, EanMatchLike> };
  return body.results?.[variant.id];
}

/** Every variant id that already carries an offer mapping on `connectionId`. */
async function listedVariantIds(api: ApiClient, connectionId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await api.listings.list({ connectionId, limit: 100, offset });
    for (const mapping of page.items) ids.add(mapping.internalId);
    offset += 100;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return ids;
}

/** The product's source-platform category ids (on the wire, absent from the local type). */
function sourceCategoryIds(product: Product): string[] {
  const categories = (product as unknown as { categories?: unknown }).categories;
  return Array.isArray(categories) ? categories.map(String) : [];
}

interface Fixture {
  product: Product;
  variant: ProductVariant;
  categoryId: string;
  /** A REQUIRED parameter in the `offer` section of `categoryId`. */
  offerParameter: CategoryParameter;
}

/**
 * Find the shortest reproduction from the finding: a variant whose EAN gives a
 * UNIQUE Allegro catalogue-card match. A card-linked row is exempt from
 * `computeNeedsProductParameters` and its category is dropped from
 * `noCardCategoryIds`, so the wizard never even fetches a schema for it - the
 * row is unconditionally green - while the backend still demands the category's
 * required offer-section parameters.
 *
 * Already-listed variants are excluded: `filterAlreadyListed` would silently
 * drop them (F2's own divergence) and the batch would 400 instead.
 */
async function findCardLinkedFixture(
  env: E2eEnv,
  token: string,
  api: ApiClient,
  world: World,
  connectionId: string,
): Promise<Fixture | undefined> {
  const listed = await listedVariantIds(api, connectionId);
  for (const summary of await world.listProducts(60)) {
    const product = await api.products.getById(summary.id);
    const variants = product.variants ?? [];
    // Single-variant only: a multi-variant row additionally triggers the F12
    // family-category pin, which would change WHICH divergence fires first.
    if (variants.length !== 1) continue;
    const variant = variants[0];
    if (listed.has(variant.id)) continue;
    if (!(variant.ean ?? variant.gtin)) continue;

    const match = await resolveCategory(env, token, connectionId, variant, sourceCategoryIds(product));
    if (match?.kind !== 'matched') continue;
    const categoryId = match.allegroCategoryId ?? '';
    // A NON-EMPTY productCardId is what makes the row card-linked (and so
    // exempt from every FE parameter blocker).
    if (categoryId === '' || !match.productCardId) continue;

    const parameters = await api.listings.categoryParameters(connectionId, categoryId);
    const offerParameter = parameters.find((p) => p.required && p.section === 'offer');
    if (!offerParameter) continue;

    return { product, variant, categoryId, offerParameter };
  }
  return undefined;
}

/**
 * The Review step's submit CTA, tolerant of both label generations: the build
 * this suite's page object was written against renders "Approve all (N)", the
 * current one renders "Create offers (N)". The `(N)` suffix is what keeps this
 * from also matching the confirm modal's own bare "Create offers" button.
 */
function submitCta(page: import('@playwright/test').Page): import('@playwright/test').Locator {
  return page.getByRole('button', { name: /^(Approve all|Create offers)\s*\(\d+\)$/ });
}

/**
 * Read the Review step's readiness counters straight off its `role="status"`
 * summary. The shared page object's `needsAttentionCount()` assumes the older
 * "N row(s) need attention" phrasing and parses the FIRST number in the hint;
 * the current build renders "N ready · M need attention · K excluded", so that
 * parse returns the READY count. Anchor on the labelled number instead.
 */
async function readinessCounts(
  page: import('@playwright/test').Page,
): Promise<{ ready: number; needAttention: number; raw: string }> {
  const hint = page.getByRole('status').filter({ hasText: /needs? attention/ }).first();
  if ((await hint.count()) === 0) return { ready: 0, needAttention: 0, raw: '(no readiness hint)' };
  const raw = (await hint.innerText()).replace(/\s+/g, ' ').trim();
  const attention = /(\d+)\s+needs?\s+attention/i.exec(raw);
  const ready = /(\d+)\s+ready/i.exec(raw);
  return {
    ready: ready ? Number(ready[1]) : 0,
    needAttention: attention ? Number(attention[1]) : 0,
    raw,
  };
}

/**
 * Pick the destination connection on the Config step.
 *
 * The step renders a grouped RADIO RAIL (`PublishDestinationRail`) when more
 * than one publish destination exists, and a plain "Publishing as {name}" alert
 * when there is only one - the shared page object's `<select>` path
 * (`selectConnectionIfPresent`) only covers the older select-based layout, so
 * try the rail first and fall back to it. Kept local per the suite's rule that
 * a divergence spec must not edit shared page objects.
 */
async function selectDestination(
  page: import('@playwright/test').Page,
  wizard: BulkOfferWizard,
  connectionName: string,
): Promise<void> {
  const escaped = connectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const radio = page.getByRole('radio', { name: new RegExp(escaped) });
  if ((await radio.count()) > 0) {
    await radio.first().click();
    return;
  }
  await wizard.selectConnectionIfPresent(connectionName);
}

/**
 * Wait until the Review step has SETTLED - the async per-category parameter
 * schema has resolved and the row blockers reflect it. Mirrors the page
 * object's own (private) settle gate so a transient "0 need attention, submit
 * disabled" limbo is never read as readiness, but against the local
 * build-tolerant locators above.
 */
async function waitForReviewSettled(page: import('@playwright/test').Page): Promise<void> {
  await expect(async () => {
    const cta = submitCta(page).first();
    if ((await cta.count()) === 0) {
      throw new Error('Review step has not rendered its submit CTA yet.');
    }
    const [enabled, counts] = await Promise.all([cta.isEnabled(), readinessCounts(page)]);
    if (!enabled && counts.needAttention === 0) {
      throw new Error(`Review still resolving: submit disabled with no needs-attention rows (${counts.raw}).`);
    }
  }).toPass({ timeout: 60_000 });
}

/** Every `overrides.parameters` entry submitted for `variantId`, across both maps. */
function submittedParameters(body: unknown, variantId: string): { id?: string; name?: string }[] {
  const request = body as Record<string, unknown>;
  const collected: { id?: string; name?: string }[] = [];
  for (const map of ['perProductOverrides', 'perVariantOverrides']) {
    const entries = request[map];
    if (typeof entries !== 'object' || entries === null) continue;
    const entry = (entries as Record<string, unknown>)[variantId] as
      | { overrides?: { parameters?: unknown } }
      | undefined;
    const parameters = entry?.overrides?.parameters;
    if (Array.isArray(parameters)) collected.push(...(parameters as { id?: string; name?: string }[]));
  }
  return collected;
}

function platformConfig(connection: Connection): {
  requiresDeliveryPolicy?: boolean;
  requiresErliBuyabilityFields?: boolean;
} {
  return connection.platformType === 'erli'
    ? { requiresErliBuyabilityFields: true }
    : { requiresDeliveryPolicy: true };
}

test.describe('F1 - offer-section required parameters have no wizard-side counterpart', () => {
  test('a card-linked row is green, submits 202, and its record fails PARAMETER_REQUIRED', async ({
    env,
    api,
    world,
    page,
    pages,
    poll,
  }: {
    env: E2eEnv;
    api: ApiClient;
    world: World;
    page: import('@playwright/test').Page;
    pages: import('../../src/pages').PageObjects;
    poll: Poller;
  }) => {
    // Fixture resolution walks the catalogue and runs the real category-resolution
    // chain per candidate, then waits on a worker round-trip - well past the
    // suite's default 90s per-test budget. Local to this spec (the shared
    // playwright.config is not touched).
    test.setTimeout(300_000);
    const allegro = world.connectionFor('allegro');
    test.skip(!allegro, 'no Allegro connection on this stack');

    const token = await bearer(env);
    const fixture = await findCardLinkedFixture(env, token, api, world, allegro!.id);
    test.skip(
      !fixture,
      'No usable fixture: this stack has no SINGLE-VARIANT master product that is (a) not yet ' +
        'listed on the Allegro connection, (b) whose EAN resolves to a UNIQUE Allegro catalogue ' +
        'product card (resolve-batch kind="matched" with a non-empty productCardId), and (c) ' +
        'whose matched category carries a required section="offer" parameter. Create one by ' +
        'importing a simple PrestaShop product whose ean13 is a real GS1 barcode present in the ' +
        'Allegro (sandbox) catalogue - e.g. 3165140846264, which matches category 252043 whose ' +
        '"Stan" (id 11323) is required + section="offer" - then run master.product.syncAll. ' +
        'Without a card link the wizard raises its own needs-product-parameters blocker and the ' +
        'row is no longer submittable un-edited, which is a different scenario.',
    );

    await page.goto(`/listings/bulk-create/wizard?productIds=${fixture!.product.id}`);
    const wizard = pages.bulkOfferWizard;
    await wizard.expectOnConfigStep();
    await selectDestination(page, wizard, allegro!.name);

    // Deliberately NO row editing - the edit modal renders every parameter
    // section and would satisfy the backend gate, hiding the divergence.
    await wizard.completePlatformConfig(platformConfig(allegro!));
    await expect(wizard.proceedButton).toBeEnabled({ timeout: 30_000 });
    await wizard.proceedButton.click();
    await expect(submitCta(page).first()).toBeVisible({ timeout: 60_000 });
    await waitForReviewSettled(page);

    // ── (a) The wizard reports the row as ready ────────────────────────────
    expect(
      (await readinessCounts(page)).needAttention,
      `the wizard flags nothing on a row whose category (${fixture!.categoryId}) requires the ` +
        `offer-section parameter "${fixture!.offerParameter.name}" (id ${fixture!.offerParameter.id})`,
    ).toBe(0);
    await expect(
      submitCta(page).first(),
      'the wizard enables submit - the row reads "ready"',
    ).toBeEnabled();

    // PROOF (documentation only - never asserted on): the promise.
    await captureProof(page, 'f01-before-review-ready', { region: reviewRegion(page) });

    await submitCta(page).first().click();
    await expect(wizard.confirmModalConfirmButton).toBeVisible();
    await wizard.publishImmediatelyCheckbox.check();

    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/listings/bulk-create'),
      { timeout: 60_000 },
    );
    await wizard.confirmModalConfirmButton.click();
    const response = await submitted;

    // The submitted override carries no value for the parameter the backend
    // is about to demand - the wizard never asked for it.
    const requestBody: unknown = JSON.parse(response.request().postData() ?? '{}');
    const parameters = submittedParameters(requestBody, fixture!.variant.id);
    expect(
      parameters.some(
        (p) => p.id === fixture!.offerParameter.id || p.name === fixture!.offerParameter.name,
      ),
      `the batch is submitted without a value for "${fixture!.offerParameter.name}"`,
    ).toBe(false);

    // ── (b) The server accepts the batch, then the record dies on it ───────
    expect(
      response.status(),
      'the submit is accepted - the divergence surfaces later, per record',
    ).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    // Confirm was already clicked above (to capture the request), so just wait
    // for the redirect the wizard performs on a 2xx.
    await page.waitForURL(/\/listings\/bulk-batches\/[^/]+$/, { timeout: 30_000 });
    const batchId = pages.bulkBatchProgress.batchId;
    expect(batchId, 'a batch id is minted - the request was NOT rejected').toBeTruthy();

    const batch = await poll.until(
      () => api.listings.getBulkBatch(batchId),
      (summary) => TERMINAL_BATCH_STATUSES.has(summary.status),
      { message: `bulk batch ${batchId} to reach a terminal status`, timeoutMs: 180_000 },
    );

    // PROOF (documentation only): what actually happened to the "ready" batch.
    await captureProof(page, 'f01-before-result', {
      fullPage: true,
      prepare: async () => {
        await page.goto(`/listings/bulk-batches/${batchId}`);
        await page.locator('button[aria-label^="Failure details for"]').first().click();
        await expect(page.locator('.bulk-batch__err-list').first()).toBeVisible({
          timeout: 15_000,
        });
      },
    });

    const errors = batch.records.flatMap(
      (record) => ((record as unknown as { errors?: RecordError[] | null }).errors ?? []),
    );
    expect(
      batch.failedCount,
      `every child of the batch the wizard called ready should fail. Records: ${JSON.stringify(
        batch.records.map((r) => ({
          variant: r.internalVariantId,
          status: r.status,
          errors: (r as unknown as { errors?: RecordError[] | null }).errors,
        })),
      )}`,
    ).toBeGreaterThan(0);
    expect(
      errors.some(
        (error) =>
          error.code === 'PARAMETER_REQUIRED' &&
          (error.field ?? '').includes(fixture!.offerParameter.name),
      ),
      `a record fails with PARAMETER_REQUIRED on parameters.${fixture!.offerParameter.name}. ` +
        `Observed: ${JSON.stringify(errors)}`,
    ).toBe(true);
  });
});
