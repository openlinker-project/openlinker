/**
 * F12 / F12b - the wizard injects `overrides.categoryId`; the DTO deletes it
 *
 * ⚠️ CHARACTERIZATION TEST. These specs pass **while the divergence exists** and
 * go RED once it is closed. A failure here is NOT a regression - it means the
 * finding was wrong, or it has been fixed and this file should be retired (or
 * inverted into a normal regression test).
 *
 * WHAT THIS FILE CHARACTERIZES: `main`'s behaviour, verified by source read -
 * `origin/main:apps/api/src/listings/http/dto/bulk-offer-create.dto.ts` declares
 * `OverridesNoCategoryDto = OmitType(CreateOfferOverridesDto, ['categoryId'])`,
 * uses it as `PerVariantOverrideDto.overrides`, and validates BOTH
 * `perProductOverrides` and `perVariantOverrides` through
 * `@ValidateRecordValues(() => PerVariantOverrideDto)`, whose inner `validate()`
 * runs with `whitelist: true, forbidNonWhitelisted: true`. A `categoryId` in
 * either map is therefore a whole-request 400 on main.
 *
 * ⚠️ A FIX IS ALREADY IN FLIGHT. Commit `a9477d60` (2026-07-29) on branch
 * `1924-bulk-category-per-family-per-variant`, open as **PR #1930** (not an
 * ancestor of `main` at the time of writing), describes this finding verbatim
 * and removes the `categoryId` restriction from BOTH override maps, turning the
 * variant-tier strip into a destination-aware service decision. So once #1930
 * merges these tests are EXPECTED to go red: that red run is the success
 * signal, not a regression, and it is the moment to invert this file into the
 * regression guard for the fix (assert the request is ACCEPTED and the category
 * lands where the service intends).
 *
 * ⚠️ THE TWO PATHS HAVE DIFFERENT ORIGINS - and only one of them is covered by
 * the in-flight fix's description:
 *   - The multi-variant FAMILY PIN (`bulk-wizard.tsx`) was authored in the SAME
 *     squashed commit as the DTO omission (`c2fc4238`, PR #1757 / issue #1741):
 *     a self-inflicted regression, shipped broken on day one.
 *   - The EDIT-MODAL emit (`bulk-edit-modal.tsx`) PREDATES #1741 and was legal
 *     before it - the override maps used to nest the full
 *     `CreateOfferOverridesDto` (`categoryId` included) and
 *     `@ValidateRecordValues` did not exist. #1741 narrowed a backend contract
 *     without auditing existing senders.
 *   PR #1930's body does NOT mention the edit-modal path, so **F12b below is the
 *   more valuable of the two tests**: it is the one that can survive the fix if
 *   the fix only addresses the family pin.
 *
 * The divergence, in one sentence: `PerVariantOverrideDto.overrides` is
 * `OmitType(CreateOfferOverridesDto, ['categoryId'])` (#1741,
 * `apps/api/src/listings/http/dto/bulk-offer-create.dto.ts`) validated under
 * `whitelist + forbidNonWhitelisted` via `@ValidateRecordValues`, while the
 * bulk wizard puts `categoryId` into exactly that map on two independent paths:
 *
 *   F12  - the multi-variant FAMILY PIN. `bulk-wizard.tsx` deliberately stamps
 *          `overrides.categoryId = row.override.overrides?.categoryId ??
 *          row.resolvedCategoryId` onto `perProductOverrides[primaryVariantId]`
 *          for a product with >1 variant, so Allegro groups the siblings under
 *          one category. Nothing is edited; every row is green.
 *   F12b - the EDITED-ROW path. The per-row edit modal seeds and emits
 *          `categoryId` in its saved override, so any batch in which the
 *          operator saved even one row carries the same forbidden key.
 *
 * Either way the rejection is whole-request: HTTP 400, zero batch, zero
 * records - after a Review step that showed every row `ready`.
 *
 * Both tests assert BOTH sides:
 *   (a) the wizard reports the rows as ready and enables the submit CTA, AND
 *   (b) the submitted request carries `overrides.categoryId`, AND
 *   (c) the API rejects the whole request with 400 naming the override map.
 *
 * There is no legal channel for the wizard to pass a category: the DTO's own
 * contract says "base-only via `sharedConfig`", but the wizard's `sharedConfig`
 * carries only `platformParams`.
 *
 * @module tests/preflight-divergence
 */
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Connection, Product } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import type { World } from '../../src/world/world';
import type { BulkOfferWizard } from '../../src/pages/bulk-offer-wizard.page';

/** A deliberately-unknown variant id used only by the read-only contract probe. */
const PROBE_VARIANT_ID = 'ol_variant_preflight_divergence_probe';

/** Minimal raw-API surface this spec needs but the shared client does not expose. */
interface RawJsonResponse {
  status: number;
  body: unknown;
}

/** Acquire a bearer token for the raw calls below (the shared client hides its own). */
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

async function rawPost(
  env: E2eEnv,
  token: string,
  path: string,
  body: unknown,
): Promise<RawJsonResponse> {
  const response = await fetch(`${env.apiUrl}/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep the raw text */
  }
  return { status: response.status, body: parsed };
}

/**
 * Read-only probe of the live DTO contract: is `categoryId` actually forbidden
 * inside the per-product / per-variant override maps on THIS stack?
 *
 * The probe deliberately fails an UNRELATED rule (`sharedConfig.stock: -1`
 * violates `@Min(0)`), so the global ValidationPipe rejects before the handler
 * ever runs - nothing is enqueued, no batch is created. class-validator reports
 * every violation at once, so the response tells us whether the override maps
 * also rejected `categoryId`.
 *
 * Returns the full 400 message list so a skip can quote what the stack said.
 */
async function probeCategoryOmittedFromOverrides(
  env: E2eEnv,
  token: string,
  connectionId: string,
): Promise<{ armed: boolean; messages: string[] }> {
  const overrideValue = { overrides: { categoryId: '261481' } };
  const result = await rawPost(env, token, '/listings/bulk-create', {
    connectionId,
    productIds: [PROBE_VARIANT_ID],
    sharedConfig: { stock: -1, publishImmediately: true },
    perProductOverrides: { [PROBE_VARIANT_ID]: overrideValue },
    perVariantOverrides: { [PROBE_VARIANT_ID]: overrideValue },
  });

  expect(
    result.status,
    'the contract probe must be rejected by validation alone (stock: -1) and never reach the handler',
  ).toBe(400);

  const raw = (result.body as { message?: unknown }).message;
  const messages = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
  const armed = messages.some((m) => /per(Product|Variant)Overrides/i.test(m));
  return { armed, messages };
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

/** The product's source-platform category ids (present on the wire, absent from the local type). */
function sourceCategoryIds(product: Product): string[] {
  const categories = (product as unknown as { categories?: unknown }).categories;
  return Array.isArray(categories) ? categories.map(String) : [];
}

interface EanMatchLike {
  kind: string;
  allegroCategoryId?: string | null;
  productCardId?: string | null;
}

/** Run the wizard's own Resolve-step query for a product's variants. */
async function resolveCategories(
  env: E2eEnv,
  token: string,
  connectionId: string,
  product: Product,
): Promise<Record<string, EanMatchLike>> {
  const categories = sourceCategoryIds(product);
  const items = (product.variants ?? []).map((variant) => ({
    variantId: variant.id,
    ean: variant.ean ?? variant.gtin ?? null,
    ...(categories.length > 0 ? { sourceCategoryIds: categories } : {}),
  }));
  const result = await rawPost(
    env,
    token,
    `/listings/connections/${connectionId}/categories/resolve-batch`,
    { items },
  );
  if (result.status !== 200) return {};
  return ((result.body as { results?: Record<string, EanMatchLike> }).results ?? {});
}

/**
 * Find a product on the stack matching a predicate, hydrated with its variants
 * and never already listed on `connectionId` (an already-listed variant is
 * silently dropped by `filterAlreadyListed`, which would mask this finding
 * behind F2's own divergence).
 */
async function findFreshProduct(
  api: ApiClient,
  world: World,
  connectionId: string,
  accept: (product: Product) => boolean | Promise<boolean>,
): Promise<Product | undefined> {
  const listed = await listedVariantIds(api, connectionId);
  for (const summary of await world.listProducts(60)) {
    const product = await api.products.getById(summary.id);
    const variants = product.variants ?? [];
    if (variants.length === 0) continue;
    if (variants.some((variant) => listed.has(variant.id))) continue;
    if (await accept(product)) return product;
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

/** Per-platform required config on the wizard's Config step. */
function platformConfig(connection: Connection): {
  requiresDeliveryPolicy?: boolean;
  requiresErliBuyabilityFields?: boolean;
} {
  return connection.platformType === 'erli'
    ? { requiresErliBuyabilityFields: true }
    : { requiresDeliveryPolicy: true };
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

/**
 * Drive Config → Resolve → Review WITHOUT opening a single row editor. The F12
 * family-pin path is defined by "nothing was edited", so the page object's
 * `advanceToConfirmModal` (which fills and saves every row) cannot be used here
 * - saving a row would additionally trigger F12b and blur which path injected.
 */
async function driveToReviewWithoutEditing(
  page: import('@playwright/test').Page,
  wizard: BulkOfferWizard,
  connection: Connection,
): Promise<void> {
  await wizard.completePlatformConfig(platformConfig(connection));
  await expect(wizard.proceedButton).toBeEnabled({ timeout: 30_000 });
  await wizard.proceedButton.click();
  await expect(submitCta(page).first()).toBeVisible({ timeout: 60_000 });
  await waitForReviewSettled(page);
}

/** Collect every `overrides.categoryId` present in a submitted bulk-create body. */
function injectedCategoryIds(body: unknown): { map: string; variantId: string; categoryId: string }[] {
  const found: { map: string; variantId: string; categoryId: string }[] = [];
  const request = body as Record<string, unknown>;
  for (const map of ['perProductOverrides', 'perVariantOverrides']) {
    const entries = request[map];
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [variantId, value] of Object.entries(entries as Record<string, unknown>)) {
      const overrides = (value as { overrides?: { categoryId?: unknown } } | null)?.overrides;
      const categoryId = overrides?.categoryId;
      if (typeof categoryId === 'string' && categoryId !== '') {
        found.push({ map, variantId, categoryId });
      }
    }
  }
  return found;
}

test.describe('F12 - the wizard sends a category the DTO deletes', () => {
  test('F12: a multi-variant family pin is injected and the whole request is rejected', async ({
    env,
    api,
    world,
    page,
    pages,
  }) => {
    // Fixture resolution walks the catalogue and runs the real category-resolution
    // chain per candidate, then waits on a worker round-trip - well past the
    // suite's default 90s per-test budget. Local to this spec (the shared
    // playwright.config is not touched).
    test.setTimeout(300_000);
    const allegro = world.connectionFor('allegro');
    test.skip(!allegro, 'no Allegro connection on this stack');

    const token = await bearer(env);
    const probe = await probeCategoryOmittedFromOverrides(env, token, allegro!.id);
    test.skip(
      !probe.armed,
      'This API build ACCEPTS `categoryId` inside perProductOverrides / perVariantOverrides, so ' +
        'the F12 backend half is not present in the deployed code and there is nothing to ' +
        'characterize HERE. This does NOT mean the finding is wrong - it is verified by source ' +
        'read against `main`. Two builds accept the key: one PREDATING #1741 (commit c2fc4238, ' +
        'before `OverridesNoCategoryDto` existed), and one carrying the FIX (PR #1930, commit ' +
        'a9477d60, branch 1924-bulk-category-per-family-per-variant), which restores `categoryId` ' +
        'at the HTTP boundary and moves the variant-tier decision into ' +
        '`BulkListingSubmitService.stripVariantCategoryId`. Tell them apart by grepping the ' +
        'deployed dist: `stripVariantCategoryId` present => the FIX (retire/invert this file); ' +
        '`excludedVariantIds` absent => a pre-#1741 build. To characterize main, deploy a build ' +
        'of `main` and re-run. ' +
        `Probe reported: ${probe.messages.join(' | ')}`,
    );

    // A multi-variant product, none of whose variants is already listed, whose
    // siblings ALL resolve to a real category - the pin is only stamped when
    // `familyCategoryId` (override ?? resolvedCategoryId) is non-null.
    const product = await findFreshProduct(api, world, allegro!.id, async (candidate) => {
      if ((candidate.variants ?? []).length < 2) return false;
      const resolved = await resolveCategories(env, token, allegro!.id, candidate);
      return (candidate.variants ?? []).every((variant) => {
        const match = resolved[variant.id];
        return match?.kind === 'matched' && !!match.allegroCategoryId;
      });
    });
    test.skip(
      !product,
      'No usable fixture: this stack has no MULTI-VARIANT master product that is (a) not yet ' +
        'listed on the Allegro connection and (b) whose every sibling resolves to a real Allegro ' +
        'category (EAN catalogue match or a configured source-category mapping). Create one by ' +
        'importing a PrestaShop product with >=2 combinations, each carrying a GTIN, into a ' +
        'source category that has a PS->Allegro category mapping, then run master.product.syncAll.',
    );

    await page.goto(`/listings/bulk-create/wizard?productIds=${product!.id}`);
    const wizard = pages.bulkOfferWizard;
    await wizard.expectOnConfigStep();
    await selectDestination(page, wizard, allegro!.name);

    await driveToReviewWithoutEditing(page, wizard, allegro!);

    // ── (a) The wizard says this batch is good to go ───────────────────────
    const needsAttention = (await readinessCounts(page)).needAttention;
    test.skip(
      needsAttention > 0,
      `The multi-variant rows are NOT green without editing (${needsAttention} need attention), ` +
        'so reaching submit would require saving a row editor - which is the F12b path, not the ' +
        'family pin. This test needs a multi-variant product whose Allegro rows are ready with ' +
        'no operator edit: every sibling card-linked by a unique GTIN match, or mapped to an ' +
        'Allegro category with no required product-section parameters.',
    );
    await expect(
      submitCta(page).first(),
      'the wizard enables submit - it considers every row ready',
    ).toBeEnabled();
    await submitCta(page).first().click();
    await expect(wizard.confirmModalConfirmButton).toBeVisible();
    await wizard.publishImmediatelyCheckbox.check();

    // ── (b)+(c) …and the server refuses the whole thing ────────────────────
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/listings/bulk-create'),
      { timeout: 60_000 },
    );
    await wizard.confirmModalConfirmButton.click();
    const response = await submitted;

    const requestBody: unknown = JSON.parse(response.request().postData() ?? '{}');
    const injected = injectedCategoryIds(requestBody);
    expect(
      injected.filter((entry) => entry.map === 'perProductOverrides'),
      'the family pin stamps overrides.categoryId onto perProductOverrides[primaryVariantId] ' +
        'even though no row editor was ever opened',
    ).not.toHaveLength(0);

    expect(
      response.status(),
      'the whole request is rejected - not one record is created',
    ).toBe(400);
    const body = (await response.json()) as { message?: unknown };
    const messages = Array.isArray(body.message) ? body.message.map(String) : [String(body.message)];
    expect(
      messages.join(' | '),
      'the rejection names the override map the wizard just wrote into',
    ).toMatch(/per(Product|Variant)Overrides/i);

    // The browser stays on the wizard: no batch id was ever minted.
    await expect(page).toHaveURL(/\/listings\/bulk-create\/wizard/);
  });

  test('F12b: an edited row injects categoryId and the whole request is rejected', async ({
    env,
    api,
    world,
    page,
    pages,
  }) => {
    // Fixture resolution walks the catalogue and runs the real category-resolution
    // chain per candidate, then waits on a worker round-trip - well past the
    // suite's default 90s per-test budget. Local to this spec (the shared
    // playwright.config is not touched).
    test.setTimeout(300_000);
    const allegro = world.connectionFor('allegro');
    test.skip(!allegro, 'no Allegro connection on this stack');

    const token = await bearer(env);
    const probe = await probeCategoryOmittedFromOverrides(env, token, allegro!.id);
    test.skip(
      !probe.armed,
      'This API build ACCEPTS `categoryId` inside perProductOverrides / perVariantOverrides, ' +
        'so the F12b backend half is absent - the build either predates #1741 (c2fc4238) or ' +
        'already carries the fix (PR #1930 / a9477d60). Note that the edit-modal path this test ' +
        'covers PREDATES #1741 and is NOT named in #1930\'s description, so re-check it ' +
        'explicitly against a post-fix build before retiring this test. ' +
        `Probe reported: ${probe.messages.join(' | ')}`,
    );

    // Single-variant product: `isMulti` is false so the family pin never fires,
    // isolating the edit-modal injection path.
    const product = await findFreshProduct(
      api,
      world,
      allegro!.id,
      (candidate) => (candidate.variants ?? []).length === 1,
    );
    test.skip(
      !product,
      'No usable fixture: this stack has no SINGLE-VARIANT master product that is not already ' +
        'listed on the Allegro connection. Import a simple PrestaShop product (one combination, ' +
        'a GTIN, a mapped source category) and run master.product.syncAll.',
    );

    const gtin = product!.variants?.[0]?.ean ?? product!.variants?.[0]?.gtin ?? undefined;

    await page.goto(`/listings/bulk-create/wizard?productIds=${product!.id}`);
    const wizard = pages.bulkOfferWizard;
    await wizard.expectOnConfigStep();
    await selectDestination(page, wizard, allegro!.name);

    // ── (a) Drive the wizard exactly as an operator who opens the row editor.
    // `advanceToConfirmModal` opens each row's editor, fills its required
    // fields and SAVES - the very act that seeds `overrides.categoryId`. It
    // only reaches the confirm modal once "Approve all" is enabled, i.e. once
    // the wizard itself declares every row ready.
    await wizard.advanceToConfirmModal({
      requiresDeliveryPolicy: allegro!.platformType !== 'erli',
      requiresErliBuyabilityFields: allegro!.platformType === 'erli',
      gtin,
    });
    await expect(wizard.confirmModalConfirmButton).toBeVisible();

    // ── (b)+(c) …and the server refuses the whole thing ────────────────────
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/listings/bulk-create'),
      { timeout: 60_000 },
    );
    await wizard.confirmModalConfirmButton.click();
    const response = await submitted;

    const requestBody: unknown = JSON.parse(response.request().postData() ?? '{}');
    expect(
      injectedCategoryIds(requestBody),
      'the saved row editor emits overrides.categoryId into the per-override map',
    ).not.toHaveLength(0);

    expect(response.status(), 'the whole request is rejected - zero records').toBe(400);
    const body = (await response.json()) as { message?: unknown };
    const messages = Array.isArray(body.message) ? body.message.map(String) : [String(body.message)];
    expect(messages.join(' | ')).toMatch(/per(Product|Variant)Overrides/i);
    await expect(page).toHaveURL(/\/listings\/bulk-create\/wizard/);
  });
});
