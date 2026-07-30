/**
 * F10 - Erli's category gate: the backend requires, the frontend suppresses
 *
 * ⚠️ CHARACTERIZATION TEST. This spec passes **while the divergence exists** and
 * goes RED once it is closed. A failure here is NOT a regression - it means the
 * finding was wrong, or it has been fixed and this file should be retired (or
 * inverted into a normal regression test).
 *
 * The divergence is a capability-discovery mismatch between a STATIC manifest
 * and a RUNTIME duck-typed instance:
 *
 *   Backend: `OfferBuilderService` computes
 *     `requiresResolvedCategory = isCategoryBrowser(destination) || isEanCategoryMatcher(destination)`
 *   and both guards are pure duck-typing on the resolved adapter instance
 *   (`typeof adapter.fetchCategories === 'function'`). `ErliOfferManagerAdapter`
 *   attaches `fetchCategories` + `fetchCategoryParameters` in its constructor
 *   whenever `ErliAdapterFactory.buildAllegroCategoryCatalog` returns a client -
 *   and that decision is made SOLELY from the stored credentials
 *   (`allegroClientId` + `allegroClientSecret`). `config.allegroCategoryAccessEnabled`
 *   is never read there. So an Erli connection carrying Allegro category
 *   credentials arms Gate 1: a null category ⇒ `overrides.categoryId / REQUIRED`.
 *
 *   Frontend: `bulk-wizard.tsx` derives
 *     `destinationResolvesCategoryAtSubmit = !supportedCapabilities.includes('EanCategoryMatcher')`
 *   from the connection response's STATIC manifest (`erli-plugin.ts`), which
 *   never lists it. That is true for EVERY Erli connection, so `bulk-policy.ts`
 *   skips the `no-match` / `no-ean` / `multi-match` category blockers entirely.
 *   The wizard cannot discover otherwise either: `resolveCategoriesBatch`
 *   short-circuits every borrows-taxonomy item to `{kind:'no-match'}` before the
 *   mapping fallback, so `resolvedCategoryId` stays null and nothing is pinned.
 *
 * Both sides are asserted:
 *   (a) the connection's advertised capabilities do NOT include a category
 *       capability, the wizard shows every row ready and enables submit, AND
 *   (b) the batch is accepted and every child terminates `failed` with
 *       `overrides.categoryId` / `REQUIRED`.
 *
 * Plus the sharpening from the finding: the trigger is CREDENTIALS, not the UI
 * toggle. Turning "Allegro category access" off writes
 * `config.allegroCategoryAccessEnabled: false` while the Allegro keys stay in
 * the credential store - so the backend gate stays armed and the frontend
 * reports category browsing as disabled.
 *
 * @module tests/preflight-divergence
 */
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Connection, Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import type { World } from '../../src/world/world';
import type { BulkOfferWizard } from '../../src/pages/bulk-offer-wizard.page';
import type { Poller } from '../../src/support/poller';
import { captureProof, reviewRegion } from './__proof__/capture';

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

/**
 * Prove the Erli adapter instance really carries the duck-typed category
 * methods, without inspecting credentials (which the API never exposes).
 *
 * `GET /listings/connections/:id/categories/:categoryId/parameters` reaches the
 * SAME adapter instance the offer builder resolves, and only answers when
 * `fetchCategoryParameters` was attached in the constructor - i.e. exactly when
 * `buildAllegroCategoryCatalog` returned a client from the stored Allegro keys.
 * A non-empty parameter list therefore means `isCategoryBrowser(adapter)` is
 * true and `requiresResolvedCategory` is armed for this connection.
 */
async function backendCategoryGateArmed(
  api: ApiClient,
  connectionId: string,
  probeCategoryId: string,
): Promise<boolean> {
  try {
    const parameters = await api.listings.categoryParameters(connectionId, probeCategoryId);
    return parameters.length > 0;
  } catch {
    return false;
  }
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

function sourceCategoryIds(product: Product): string[] {
  const categories = (product as unknown as { categories?: unknown }).categories;
  return Array.isArray(categories) ? categories.map(String) : [];
}

interface EanMatchLike {
  kind: string;
  allegroCategoryId?: string | null;
}

/** Run the wizard's own Resolve-step query, exactly as the Review step does. */
async function resolveCategories(
  env: E2eEnv,
  token: string,
  connectionId: string,
  product: Product,
): Promise<Record<string, EanMatchLike>> {
  const categories = sourceCategoryIds(product);
  const response = await fetch(
    `${env.apiUrl}/v1/listings/connections/${connectionId}/categories/resolve-batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: (product.variants ?? []).map((variant: ProductVariant) => ({
          variantId: variant.id,
          ean: variant.ean ?? variant.gtin ?? null,
          ...(categories.length > 0 ? { sourceCategoryIds: categories } : {}),
        })),
      }),
    },
  );
  if (!response.ok) return {};
  return ((await response.json()) as { results?: Record<string, EanMatchLike> }).results ?? {};
}

/**
 * Source-category ids that the taxonomy OWNER has a configured destination
 * mapping for. Erli borrows Allegro's taxonomy (#1045), so the server-side
 * resolution chain falls back to these rows — a product sitting in one of these
 * categories WILL resolve at submit and pass Gate 1 (it then dies on F1's
 * offer-parameter gate instead, which is a different finding).
 */
async function mappedSourceCategoryIds(
  env: E2eEnv,
  token: string,
  ownerConnectionId: string,
): Promise<Set<string>> {
  const response = await fetch(
    `${env.apiUrl}/v1/connections/${ownerConnectionId}/mappings/categories`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return new Set();
  const rows = (await response.json()) as { prestashopCategoryId?: unknown }[];
  return new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => (row.prestashopCategoryId === undefined ? '' : String(row.prestashopCategoryId)))
      .filter((id) => id !== ''),
  );
}

/**
 * A product whose Erli rows reach Review green and whose category the backend
 * genuinely cannot resolve. Four conditions, each closing a way the run could
 * otherwise land on a DIFFERENT finding:
 *
 *   1. Not already listed on the connection — `filterAlreadyListed` would drop
 *      it and the request would 400 on F2's path instead.
 *   2. Priced, and carrying at least one image — Erli's only bulk blocker is
 *      `missing-image`, so an image-less row would not be green.
 *   3. Its source categories are disjoint from the taxonomy owner's configured
 *      category mappings, AND the owner's own resolve chain finds no catalogue
 *      match for any variant. This is the real Gate-1 predicate: the FE's own
 *      Erli preview is useless here because `resolveCategoriesBatch`
 *      short-circuits every borrows-taxonomy item to `no-match` before the
 *      mapping fallback — a product in a MAPPED category still resolves at
 *      submit and fails on F1's parameter gate instead.
 *   4. The Erli-side preview also reports no match (documents the FE's view).
 */
async function findUnresolvableProduct(
  env: E2eEnv,
  token: string,
  api: ApiClient,
  world: World,
  connectionId: string,
  taxonomyOwner: Connection | undefined,
): Promise<Product | undefined> {
  const listed = await listedVariantIds(api, connectionId);
  const mapped = taxonomyOwner
    ? await mappedSourceCategoryIds(env, token, taxonomyOwner.id)
    : new Set<string>();

  for (const summary of await world.listProducts(60)) {
    const product = await api.products.getById(summary.id);
    const variants = product.variants ?? [];
    if (variants.length === 0) continue;
    if (variants.some((variant) => listed.has(variant.id))) continue;
    const images = (product as unknown as { images?: unknown }).images;
    if (!Array.isArray(images) || images.length === 0) continue;
    if (product.price === null || product.price <= 0) continue;
    if (sourceCategoryIds(product).some((id) => mapped.has(id))) continue;

    if (taxonomyOwner) {
      const ownerResolved = await resolveCategories(env, token, taxonomyOwner.id, product);
      const ownerFindsNothing = variants.every((variant) => {
        const match = ownerResolved[variant.id];
        return !match || match.kind !== 'matched' || !match.allegroCategoryId;
      });
      if (!ownerFindsNothing) continue;
    }

    const resolved = await resolveCategories(env, token, connectionId, product);
    const everyVariantUnresolved = variants.every((variant) => {
      const match = resolved[variant.id];
      return !match || match.kind !== 'matched' || !match.allegroCategoryId;
    });
    if (everyVariantUnresolved) return product;
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

/** Resolve the Erli connection whose backend category gate is armed. */
async function armedErliConnection(
  api: ApiClient,
  world: World,
  probeCategoryId: string,
): Promise<Connection | undefined> {
  for (const connection of world.connectionsFor('erli')) {
    if (connection.status !== 'active') continue;
    // The FE-suppression half: the static manifest must NOT advertise the
    // capability the wizard keys off. If it ever does, the FE stops suppressing
    // and the divergence is closed.
    if (connection.supportedCapabilities.includes('EanCategoryMatcher')) continue;
    if (await backendCategoryGateArmed(api, connection.id, probeCategoryId)) return connection;
  }
  return undefined;
}

test.describe('F10 - Erli category gate: backend requires, frontend suppresses', () => {
  test('rows are green, submit is accepted, every child fails overrides.categoryId/REQUIRED', async ({
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
    const probeCategoryId = env.freshAllegroCategoryId;
    const erli = await armedErliConnection(api, world, probeCategoryId);
    test.skip(
      !erli,
      'No usable fixture: this stack has no ACTIVE Erli connection that (a) omits ' +
        '"EanCategoryMatcher" from its advertised supportedCapabilities and (b) can actually read ' +
        `Allegro category parameters (probe: GET /listings/connections/:id/categories/${probeCategoryId}/parameters). ` +
        'Configure an Erli connection with Allegro category credentials (allegroClientId + ' +
        'allegroClientSecret in its credential payload) - that is what duck-types fetchCategories ' +
        'onto the adapter and arms the backend gate. Override the probe category with ' +
        'E2E_FRESH_ALLEGRO_CATEGORY_ID if 261481 is not reachable on your Allegro app.',
    );

    // (a) The FE-visible half, stated explicitly: nothing in the advertised
    // capability set tells the wizard a category is required here.
    expect(
      erli!.supportedCapabilities,
      'the static manifest advertises no EAN-category capability, so the wizard treats the ' +
        'destination as resolving its category server-side at submit',
    ).not.toContain('EanCategoryMatcher');
    expect(erli!.supportedCapabilities).not.toContain('CategoryBrowser');

    const token = await bearer(env);
    // Erli borrows Allegro's taxonomy (#1045): the server-side chain falls back
    // to the OWNER's category mappings, so the owner connection is the oracle
    // for "will Gate 1 actually find a category?".
    const taxonomyOwner = world
      .connectionsWithCapability('EanCategoryMatcher')
      .find((candidate) => candidate.status === 'active');
    const product = await findUnresolvableProduct(env, token, api, world, erli!.id, taxonomyOwner);
    test.skip(
      !product,
      'No usable fixture: this stack has no master product that is (a) not yet listed on the Erli ' +
        'connection, (b) priced and carrying at least one image (Erli\'s only bulk blocker is ' +
        'missing-image), and (c) genuinely unresolvable server-side: its source categories must be ' +
        'disjoint from the taxonomy owner\'s configured category mappings AND its barcodes must ' +
        'find no catalogue match. Import a fresh PrestaShop product (with an image and a price) ' +
        'into a category that has NO PS->Allegro category mapping, then run ' +
        'master.product.syncAll. NOTE: a product in a MAPPED source category resolves at submit ' +
        'and fails on F1\'s parameters.Stan gate instead - a different finding.',
    );

    await page.goto(`/listings/bulk-create/wizard?productIds=${product!.id}`);
    const wizard = pages.bulkOfferWizard;
    await wizard.expectOnConfigStep();
    await selectDestination(page, wizard, erli!.name);

    // No row editing: the divergence is that the wizard never ASKS for a
    // category here, so an operator has no reason to open the editor.
    await wizard.completePlatformConfig({ requiresErliBuyabilityFields: true });
    await expect(wizard.proceedButton).toBeEnabled({ timeout: 30_000 });
    await wizard.proceedButton.click();
    await expect(submitCta(page).first()).toBeVisible({ timeout: 60_000 });
    await waitForReviewSettled(page);

    expect(
      (await readinessCounts(page)).needAttention,
      'the wizard flags no category blocker even though no category resolved for any variant',
    ).toBe(0);
    await expect(
      submitCta(page).first(),
      'the wizard enables submit - every row reads "ready"',
    ).toBeEnabled();

    // PROOF (documentation only - never asserted on): the promise.
    await captureProof(page, 'f10-before-review-ready', { region: reviewRegion(page) });

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

    expect(response.status(), 'the submit is accepted - the gate fires per record').toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    await page.waitForURL(/\/listings\/bulk-batches\/[^/]+$/, { timeout: 30_000 });
    const batchId = pages.bulkBatchProgress.batchId;
    expect(batchId, 'a batch id is minted').toBeTruthy();

    // (b) …and every child dies on the category the wizard never asked for.
    const batch = await poll.until(
      () => api.listings.getBulkBatch(batchId),
      (summary) => TERMINAL_BATCH_STATUSES.has(summary.status),
      { message: `bulk batch ${batchId} to reach a terminal status`, timeoutMs: 180_000 },
    );

    // PROOF (documentation only): what actually happened to the green batch.
    await captureProof(page, 'f10-before-result', {
      fullPage: true,
      prepare: async () => {
        await page.goto(`/listings/bulk-batches/${batchId}`);
        await page.locator('button[aria-label^="Failure details for"]').first().click();
        await expect(page.locator('.bulk-batch__err-list').first()).toBeVisible({
          timeout: 15_000,
        });
      },
    });

    const describeRecords = JSON.stringify(
      batch.records.map((record) => ({
        variant: record.internalVariantId,
        status: record.status,
        errors: (record as unknown as { errors?: RecordError[] | null }).errors,
      })),
    );
    expect(batch.records.length, `the batch has children. ${describeRecords}`).toBeGreaterThan(0);
    expect(
      batch.failedCount,
      `every child of the "ready" batch fails. ${describeRecords}`,
    ).toBe(batch.records.length);

    const errors = batch.records.flatMap(
      (record) => (record as unknown as { errors?: RecordError[] | null }).errors ?? [],
    );
    expect(
      errors.some((error) => error.field === 'overrides.categoryId' && error.code === 'REQUIRED'),
      `a child fails with overrides.categoryId / REQUIRED. Observed: ${JSON.stringify(errors)}`,
    ).toBe(true);
  });

  test('sharpening: unchecking "Allegro category access" does NOT disarm the backend gate', async ({
    env,
    api,
    world,
  }: {
    env: E2eEnv;
    api: ApiClient;
    world: World;
  }) => {
    // Fixture resolution walks the catalogue and runs the real category-resolution
    // chain per candidate, then waits on a worker round-trip - well past the
    // suite's default 90s per-test budget. Local to this spec (the shared
    // playwright.config is not touched).
    test.setTimeout(300_000);
    const probeCategoryId = env.freshAllegroCategoryId;
    const erli = await armedErliConnection(api, world, probeCategoryId);
    test.skip(
      !erli,
      'No usable fixture: no ACTIVE Erli connection whose backend category gate is armed ' +
        '(see the first test in this file for how to configure one).',
    );

    const originalConfig = { ...(erli!.config ?? {}) };
    test.skip(
      originalConfig.allegroCategoryAccessEnabled !== true,
      'The connection does not currently advertise `config.allegroCategoryAccessEnabled: true`, ' +
        'so there is no "checked toggle" to uncheck. Enable Allegro category access on the Erli ' +
        'connection first (Connections -> Erli -> credentials panel).',
    );

    try {
      // Exactly what the credentials panel writes when the operator unchecks the
      // toggle: a CONFIG update. The credentials object simply omits the Allegro
      // keys, and rotation is skipped entirely when nothing else was typed - so
      // the stored keys survive.
      const updated = await api.connections.update(erli!.id, {
        config: { ...originalConfig, allegroCategoryAccessEnabled: false },
      });
      expect(
        (updated.config ?? {}).allegroCategoryAccessEnabled,
        'the toggle is now off as far as the connection record (and the UI) is concerned',
      ).toBe(false);

      // …and the adapter still reads Allegro categories, because the factory
      // decides on credentials alone. So `isCategoryBrowser(adapter)` is still
      // true and Gate 1 is still armed.
      expect(
        await backendCategoryGateArmed(api, erli!.id, probeCategoryId),
        'with the toggle OFF the backend still resolves Allegro category parameters through this ' +
          'connection - ErliAdapterFactory.buildAllegroCategoryCatalog never reads ' +
          'config.allegroCategoryAccessEnabled, so requiresResolvedCategory stays true',
      ).toBe(true);
    } finally {
      // Always restore the operator-visible state, whatever happened above.
      await api.connections.update(erli!.id, { config: originalConfig });
      const restored = await api.connections.getById(erli!.id);
      expect((restored.config ?? {}).allegroCategoryAccessEnabled).toBe(true);
    }
  });
});
