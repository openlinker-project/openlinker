/**
 * F15 - the row editor emits `pricingPolicy`; the DTO forbids the property
 *
 * ⚠️ CHARACTERIZATION TEST. These specs pass **while the divergence exists** and
 * go RED once it is closed. A failure here is NOT a regression - it means the
 * finding was wrong, or it has been fixed and this file should be retired (or
 * inverted into a normal regression test asserting the request is ACCEPTED).
 *
 * THE DIVERGENCE, in one sentence: the bulk edit modal writes a per-product
 * `pricingPolicy` (and `stockPolicy`) at the TOP LEVEL of the override map value,
 * the wizard forwards that value verbatim as `perProductOverrides[primaryVariantId]`,
 * and the request DTO declares no such property - so `@ValidateRecordValues`,
 * which validates every map value under `whitelist + forbidNonWhitelisted`,
 * rejects the WHOLE request with 400 after a Review step that showed the row
 * `ready`. Same disease as F12 (`categoryId`), different property and a different
 * mechanism: F12 was an explicitly OMITTED property (`OmitType`), F15 is a
 * property that was never modelled at the HTTP boundary at all.
 *
 * SOURCE EVIDENCE - verified on BOTH trees (identical on each):
 *
 *   Emitter (frontend), `apps/web/src/features/listings/components/bulk/bulk-edit-modal.tsx`:
 *     const pricingDiverges = isMultiVariant && !pricingPolicyEquals(pricingPolicy, batchPricingPolicy);
 *     const baseOverride: BulkPerProductOverride = { …, ...(pricingDiverges ? { pricingPolicy } : {}), … };
 *   (`ol-1924@c7dd586f` L656/L664 - the build the running stack is made of;
 *    `origin/main` L655/L663 - byte-identical logic.) The same block emits
 *   `stockPolicy` on `stockDiverges`. The shop half of the modal (L2943/L2952 on
 *   1924, L2764/L2773 on main) repeats it for the shop-publish path.
 *
 *   Forwarder, `bulk-wizard.tsx` `handleSubmit`:
 *     const familyOverride: BulkPerProductOverride = isMulti && familyCategoryId
 *       ? { ...row.override, overrides: { …, categoryId: familyCategoryId } }
 *       : row.override;
 *     perProductOverrides[primaryId] = familyOverride;
 *   `row.override` IS the modal's `baseOverride`. Nothing between the modal and
 *   the wire strips the policy fields.
 *
 *   Rejecter (backend), `apps/api/src/listings/http/dto/bulk-offer-create.dto.ts`:
 *   the per-map value class declares exactly four properties - `stock`,
 *   `publishImmediately`, `price`, `overrides` - and neither `pricingPolicy` nor
 *   `stockPolicy`. It is named `PerOverrideDto` on `ol-1924` and
 *   `PerVariantOverrideDto` on `origin/main`; the property set is the same on
 *   both, so the finding is version-independent. `apps/api` and `libs` contain
 *   NO occurrence of the string `pricingPolicy` on either tree.
 *
 *   What makes it FATAL rather than ignored: `@ValidateRecordValues(() => …)`
 *   (`validate-record-values.decorator.ts`) calls
 *     validate(instance, { whitelist: true, forbidNonWhitelisted: true })
 *   on every map value. That option pair is HARDCODED inside the decorator - the
 *   global `ValidationPipe` in `apps/api/src/main.ts` also sets both, but it never
 *   recurses into `Record<>` values, so the decorator is the operative gate. It
 *   fails the whole property on the first offending entry and surfaces
 *   `perProductOverrides["…"].pricingPolicy: property pricingPolicy should not exist`.
 *
 *   The FE type even documents the mistaken assumption
 *   (`api/bulk-listings.types.ts`): "FE-only resolution input - the BE receives
 *   the already-resolved amounts and ignores these fields". The BE does not
 *   ignore them; it refuses the request.
 *
 * WHY THE OPERATOR REACHES IT: `pricingDiverges` requires (1) a MULTI-VARIANT
 * row - `isMultiVariant` gates both policy fields - and (2) a policy that differs
 * from the batch default. The multi-variant editor's shared-base scope renders a
 * "Price policy" select precisely so the operator can diverge; picking "Markup on
 * master price" seeds `percent: 10` (`nextPricingPolicy`) and arms the finding.
 * The batch default is `use-master` (`bulk-config-step.tsx`), so ANY other choice
 * diverges. Nothing in the Review step reflects the change as a blocker - the
 * policy is an input to the row's resolved price, not a validity signal.
 *
 * ORDERING NOTE (matters when reading a 400 on `origin/main`): class-validator
 * emits whitelist violations BEFORE per-property constraint errors, and
 * `@ValidateRecordValues` reports only `errors[0]`. On a build where F12 is also
 * live, a row carrying BOTH `categoryId` and `pricingPolicy` reports
 * `pricingPolicy` and MASKS the `categoryId` rejection. The same applies to
 * `stockPolicy`, which is shadowed by `pricingPolicy` whenever both diverge.
 *
 * Both halves are asserted:
 *   (a) the wizard reports the edited row `ready` and enables the submit CTA, AND
 *   (b) the submitted request really carries `perProductOverrides[…].pricingPolicy`, AND
 *   (c) the API rejects the WHOLE request with 400 naming that exact property -
 *       zero batch, zero records, the browser never leaves the wizard.
 *
 * Test 1 pins the backend half alone as a cheap, fixture-free contract probe, so
 * this file still carries a live assertion when the browser fixture is absent.
 *
 * Fixture policy: read-only. Test 1 is rejected by validation before the handler
 * runs; test 2 ends in a 400, so no batch is persisted, no job is enqueued and no
 * offer is created on any marketplace.
 *
 * @module tests/preflight-divergence
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Connection, Product } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import type { World } from '../../src/world/world';
import type { BulkOfferWizard } from '../../src/pages/bulk-offer-wizard.page';
import { captureProof, reviewRegion } from './__proof__/capture';

test.describe.configure({ mode: 'serial', timeout: 300_000 });

/** A deliberately-unknown variant id used only by the read-only contract probe. */
const PROBE_VARIANT_ID = 'ol_variant_preflight_f15_probe';

/** The policy value the probe and the editor both produce (`nextPricingPolicy`). */
const DIVERGED_PRICING_POLICY = { mode: 'markup', percent: 10 } as const;

/* ─────────────────────────────── raw API access ─────────────────────────────── */

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

/** Every message string in a Nest validation error body. */
function messagesOf(body: unknown): string[] {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.map(String);
  if (typeof message === 'string') return [message];
  return [JSON.stringify(body)];
}

/**
 * Read-only probe of the live DTO contract: does THIS build reject a top-level
 * `pricingPolicy` inside the per-product / per-variant override maps?
 *
 * The probe deliberately fails an UNRELATED rule (`sharedConfig.stock: -1`
 * violates `@Min(0)`), so the global ValidationPipe rejects before the handler
 * ever runs - nothing is enqueued, no batch is created. class-validator reports
 * every top-level violation at once, so the response tells us whether the
 * override maps also rejected the policy property.
 */
async function probePricingPolicyForbidden(
  env: E2eEnv,
  token: string,
  connectionId: string,
): Promise<{ armed: boolean; messages: string[] }> {
  const overrideValue = {
    pricingPolicy: DIVERGED_PRICING_POLICY,
    stockPolicy: { mode: 'use-master' },
  };
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

  const messages = messagesOf(result.body);
  const armed = messages.some((m) => /pricingPolicy should not exist/i.test(m));
  return { armed, messages };
}

/* ────────────────────────── local fixture discovery ────────────────────────── */

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
 * A MULTI-VARIANT master product, none of whose variants is already listed on
 * `connectionId`. Already-listed variants are silently dropped by
 * `filterAlreadyListed`, which would mask this finding behind F2's divergence.
 */
async function findFreshMultiVariantProduct(
  api: ApiClient,
  world: World,
  connectionId: string,
): Promise<Product | undefined> {
  const listed = await listedVariantIds(api, connectionId);
  for (const summary of await world.listProducts(60)) {
    const product = await api.products.getById(summary.id);
    const variants = product.variants ?? [];
    if (variants.length < 2) continue;
    if (variants.some((variant) => listed.has(variant.id))) continue;
    if ((product.price ?? 0) <= 0) continue; // a markup policy needs a master price.
    return product;
  }
  return undefined;
}

/* ───────────────────────────── wizard driving (local) ───────────────────────── */

/**
 * The Review step's submit CTA, tolerant of both label generations: the build
 * this suite's page object was written against renders "Approve all (N)", the
 * current one renders "Create offers (N)". The `(N)` suffix is what keeps this
 * from also matching the confirm modal's own bare "Create offers" button.
 */
function submitCta(page: Page): Locator {
  return page.getByRole('button', { name: /^(Approve all|Create offers)\s*\(\d+\)$/ }).first();
}

interface ReviewCounts {
  ready: number;
  attention: number;
  excluded: number;
  raw: string;
}

/**
 * Read the Review step's readiness counters straight off its `role="status"`
 * summary. The shared page object's `needsAttentionCount()` assumes the older
 * "N row(s) need attention" phrasing and parses the FIRST number in the hint;
 * the current build renders "N ready · M need attention · K excluded", so that
 * parse returns the READY count. Anchor on the labelled numbers instead.
 */
async function reviewCounts(page: Page): Promise<ReviewCounts> {
  const summary = page.getByRole('status').filter({ hasText: /ready/i }).first();
  if ((await summary.count()) === 0) {
    return { ready: 0, attention: 0, excluded: 0, raw: '(no readiness hint)' };
  }
  const raw = (await summary.innerText()).replace(/\s+/g, ' ').trim();
  const read = (pattern: RegExp): number => {
    const match = pattern.exec(raw);
    return match ? Number(match[1]) : 0;
  };
  return {
    ready: read(/(\d+)\s*ready/i),
    attention: read(/(\d+)\s*need attention/i),
    excluded: read(/(\d+)\s*excluded/i),
    raw,
  };
}

/**
 * Wait until the Review step has SETTLED - the async per-category parameter
 * schema has resolved and the row blockers reflect it. Mirrors the page object's
 * own (private) settle gate, but against the build-tolerant locators above, so a
 * transient "0 need attention, submit disabled" limbo is never read as readiness.
 */
async function waitForReviewSettled(page: Page): Promise<ReviewCounts> {
  let counts: ReviewCounts = { ready: 0, attention: 0, excluded: 0, raw: '(unread)' };
  await expect(async () => {
    const cta = submitCta(page);
    if ((await cta.count()) === 0) throw new Error('Review step has not rendered its submit CTA.');
    const [enabled, current] = await Promise.all([cta.isEnabled(), reviewCounts(page)]);
    counts = current;
    if (!enabled && current.attention === 0) {
      throw new Error(`Review still resolving: submit disabled with no flagged rows (${current.raw}).`);
    }
  }).toPass({ timeout: 90_000 });
  return counts;
}

/**
 * Pick the destination connection on the Config step.
 *
 * The step renders a grouped RADIO RAIL (`PublishDestinationRail`) when more than
 * one publish destination exists, and a plain "Publishing as {name}" alert when
 * there is only one - the shared page object's `<select>` path
 * (`selectConnectionIfPresent`) only covers the older select-based layout, so try
 * the rail first and fall back to it. Kept local per the suite's rule that a
 * divergence spec must not edit shared page objects.
 */
async function selectDestination(
  page: Page,
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

/* ─────────────────────────── row editor driving (local) ─────────────────────── */

/** True if the locator's first match becomes visible within `timeoutMs`. */
async function visibleWithin(locator: Locator, timeoutMs: number): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/**
 * Fill the row editor's required, still-empty fields.
 *
 * A local (deliberately minimal) transplant of the page object's filler: the
 * shared one is reached only through `advanceToConfirmModal`, which drives its
 * needs-attention loop off `needsAttentionCount()` - the drifted parse that
 * returns the READY count, so on the current build it demands the count to DROP
 * as rows become ready and throws instead. This spec needs the editor open for
 * its own reason (the Price-policy select), so it fills what it opened.
 *
 * Only REQUIRED parameters are touched; the optional set lives in a collapsed
 * <details> and never gates readiness. Returns false when a required control
 * could not be auto-filled, so the caller can skip with a precise reason instead
 * of failing on fixture shape.
 */
async function fillRequiredFields(page: Page, dialog: Locator, gtin?: string): Promise<boolean> {
  for (const [label, value] of [
    ['Title', 'E2E F15 characterization offer'],
    ['Description', 'Automated E2E preflight-divergence characterization offer.'],
  ] as const) {
    const field = dialog.getByLabel(label, { exact: true }).first();
    if ((await field.count()) > 0 && (await field.inputValue()).trim() === '') {
      await field.fill(value);
    }
  }

  // Wait out the per-category schema load before concluding "nothing to fill".
  await expect(async () => {
    expect(await dialog.getByText('Loading category parameters').count()).toBe(0);
  }).toPass({ timeout: 30_000 });

  const required = dialog.locator(
    'fieldset.category-parameters-step__group:not(.category-parameters-step__group--optional)',
  );
  await visibleWithin(required, 5_000);
  if ((await required.count()) === 0) return true;

  // Re-scan each pass: dependency-gated parameters only appear once their parent
  // has a value.
  for (let pass = 0; pass < 6; pass += 1) {
    let filled = false;

    const selects = required.locator('select.control');
    for (let i = 0; i < (await selects.count()); i += 1) {
      const select = selects.nth(i);
      if ((await select.inputValue()) !== '') continue;
      const value = await select.locator('option:not([value=""])').first().getAttribute('value');
      if (!value) continue;
      await select.selectOption(value);
      filled = true;
    }

    const texts = required.locator('input.control[type="text"]');
    for (let i = 0; i < (await texts.count()); i += 1) {
      const input = texts.nth(i);
      if ((await input.inputValue()).trim() !== '') continue;
      // A GTIN/EAN-typed parameter must carry a REAL barcode - the marketplace
      // rejects a placeholder - but this request never reaches the marketplace,
      // so the variant's own barcode is used purely to keep the row valid.
      const label = (await input.getAttribute('aria-label')) ?? '';
      await input.fill(gtin && /ean|gtin/i.test(label) ? gtin : 'E2E');
      filled = true;
    }

    const numbers = required.locator('input.control[type="number"]');
    for (let i = 0; i < (await numbers.count()); i += 1) {
      const input = numbers.nth(i);
      if ((await input.inputValue()).trim() !== '') continue;
      const min = await input.getAttribute('min');
      await input.fill(min && Number(min) > 1 ? min : '1');
      filled = true;
    }

    const combos = required.locator('button[role="combobox"]');
    for (let i = 0; i < (await combos.count()); i += 1) {
      const outcome = await fillComboboxIfEmpty(page, combos.nth(i));
      if (outcome === 'unfillable') return false;
      if (outcome === 'filled') filled = true;
    }

    if (!filled) return true; // steady state - every required control has a value.
  }
  return true;
}

/**
 * Pick the first selectable option in an empty single-select Combobox (a large
 * dictionary such as Allegro's 8k-entry `Marka` renders nothing until the query
 * matches, so probe digits then letters). Returns 'skipped' when the control
 * already carries a value, 'unfillable' when no option and no custom value can be
 * committed - the caller turns that into a fixture skip rather than a failure.
 */
async function fillComboboxIfEmpty(
  page: Page,
  trigger: Locator,
): Promise<'filled' | 'skipped' | 'unfillable'> {
  if (!/^pick\b/i.test((await trigger.innerText()).trim())) return 'skipped';

  await trigger.click();
  // The popover is portaled to the document body - scope to the page, not the dialog.
  const search = page.locator('.combobox__search');
  if (!(await visibleWithin(search, 10_000))) return 'unfillable';
  const listbox = page.getByRole('listbox');
  const realOptions = listbox.locator(
    '[role="option"]:not(.combobox__option--disabled):not(.combobox__option--custom)',
  );
  const anyOptions = listbox.locator('[role="option"]:not(.combobox__option--disabled)');

  if (await visibleWithin(realOptions, 800)) {
    await realOptions.first().click();
    return 'filled';
  }
  for (const probe of '0123456789aeiouymslxrtnkpbcdfgh') {
    await search.fill(probe);
    if (await visibleWithin(realOptions, 400)) {
      await realOptions.first().click();
      return 'filled';
    }
  }
  await search.fill('E2E');
  if (await visibleWithin(anyOptions, 1_000)) {
    await anyOptions.first().click();
    return 'filled';
  }
  await page.keyboard.press('Escape');
  return 'unfillable';
}

/** Collect every top-level `pricingPolicy` / `stockPolicy` in a submitted body. */
function injectedPolicies(body: unknown): { map: string; variantId: string; field: string }[] {
  const found: { map: string; variantId: string; field: string }[] = [];
  const request = body as Record<string, unknown>;
  for (const map of ['perProductOverrides', 'perVariantOverrides']) {
    const entries = request[map];
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [variantId, value] of Object.entries(entries as Record<string, unknown>)) {
      const entry = (value ?? {}) as Record<string, unknown>;
      for (const field of ['pricingPolicy', 'stockPolicy']) {
        if (entry[field] !== undefined) found.push({ map, variantId, field });
      }
    }
  }
  return found;
}

/* ──────────────────────────────── the scenarios ─────────────────────────────── */

test.describe('F15 - the wizard sends a pricing policy the DTO has never heard of', () => {
  test('the DTO forbids `pricingPolicy` in BOTH override maps (contract half)', async ({
    env,
    world,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(!allegro, 'no Allegro connection on this stack');

    const token = await bearer(env);
    const probe = await probePricingPolicyForbidden(env, token, allegro!.id);
    const joined = probe.messages.join(' | ');

    expect(
      joined,
      'the per-PRODUCT map - the one the wizard actually writes the family policy into - ' +
        'rejects the property outright (`@ValidateRecordValues` validates each map value with ' +
        'whitelist + forbidNonWhitelisted, and the value class declares no such property)',
    ).toMatch(/perProductOverrides\[.+\]\.pricingPolicy: property pricingPolicy should not exist/i);
    expect(
      joined,
      'the per-VARIANT map rejects it identically - both maps are validated against the SAME ' +
        'value class, so a future per-variant policy emitter would fail the same way',
    ).toMatch(/perVariantOverrides\[.+\]\.pricingPolicy: property pricingPolicy should not exist/i);
    expect(
      joined,
      'and the rejection is a whole-request 400: the probe also reports the unrelated ' +
        'sharedConfig violation, i.e. class-validator answered before any handler ran and ' +
        'nothing was persisted',
    ).toMatch(/sharedConfig\.stock/i);

    // `stockPolicy` rides in the same override object and is forbidden by the same
    // absence, but `@ValidateRecordValues` reports only `errors[0]`, so it is
    // shadowed whenever `pricingPolicy` is present. Pin the shadowing itself:
    // the day the message names `stockPolicy` instead, the emitter changed.
    expect(
      joined,
      'only the FIRST offending property of a map value is reported - `stockPolicy` is masked',
    ).not.toMatch(/stockPolicy should not exist/i);
  });

  test('a multi-variant row keeps `ready` after a Price-policy edit, then the whole request 400s', async ({
    env,
    api,
    world,
    page,
    pages,
  }, testInfo) => {
    // Fixture resolution walks the catalogue and the editor drives the real
    // category-parameter schema - well past the suite's default per-test budget.
    // Local to this spec (the shared playwright.config is not touched).
    test.setTimeout(600_000);
    const allegro = world.connectionFor('allegro');
    test.skip(!allegro, 'no Allegro connection on this stack');
    const connection: Connection = allegro!;

    const token = await bearer(env);
    const probe = await probePricingPolicyForbidden(env, token, connection.id);
    test.skip(
      !probe.armed,
      'This API build ACCEPTS `pricingPolicy` inside the override maps, so the F15 backend half ' +
        'is not present in the deployed code and there is nothing to characterize HERE. Either ' +
        'the DTO gained the property (the fix - retire/invert this file) or the map values are ' +
        'no longer validated by `@ValidateRecordValues`. Confirm by reading ' +
        '`apps/api/src/listings/http/dto/bulk-offer-create.dto.ts`: the finding is that its ' +
        'per-map value class (`PerOverrideDto` / `PerVariantOverrideDto`) declares only ' +
        '`stock`, `publishImmediately`, `price`, `overrides`. ' +
        `Probe reported: ${probe.messages.join(' | ')}`,
    );

    const product = await findFreshMultiVariantProduct(api, world, connection.id);
    test.skip(
      !product,
      'No usable fixture: this stack has no MULTI-VARIANT master product that is (a) not yet ' +
        `listed on "${connection.name}" (an already-listed variant is dropped by ` +
        '`filterAlreadyListed`, which would mask this finding behind F2) and (b) carries a ' +
        'master price (a `markup` policy resolves to null without one, which would flag the row ' +
        'for the WRONG reason). `pricingPolicy` is emitted ONLY for a multi-variant row - ' +
        '`pricingDiverges = isMultiVariant && !pricingPolicyEquals(...)` - so a single-variant ' +
        'product cannot exercise it. Import a PrestaShop product with >=2 priced combinations ' +
        'and run master.product.syncAll.',
    );
    const variants = product!.variants ?? [];
    const gtin = variants[0]?.ean ?? variants[0]?.gtin ?? undefined;

    await page.goto(`/listings/bulk-create/wizard?productIds=${product!.id}`);
    const wizard = pages.bulkOfferWizard;
    await wizard.expectOnConfigStep();
    await selectDestination(page, wizard, connection.name);
    await wizard.completePlatformConfig({
      requiresDeliveryPolicy: connection.platformType !== 'erli',
      requiresErliBuyabilityFields: connection.platformType === 'erli',
    });
    await expect(wizard.proceedButton).toBeEnabled({ timeout: 30_000 });
    await wizard.proceedButton.click();
    const beforeEdit = await waitForReviewSettled(page);

    // ── the operator action that arms the finding ─────────────────────────────
    // Open the row editor, complete whatever the row needs, and diverge the
    // shared-base Price policy from the batch default (`use-master`). Picking
    // "markup" seeds percent 10 (`nextPricingPolicy`), so the policy differs
    // structurally and `pricingPolicyEquals` returns false.
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    const editor = page.getByRole('dialog').first();
    // The current build labels the editor's commit "Save all"; the shared page
    // object still clicks "Save row" (a third page-object drift), so this spec
    // drives the editor itself.
    await expect(editor.getByRole('button', { name: 'Save all' })).toBeVisible({ timeout: 30_000 });

    const pricePolicy = editor.getByLabel('Price policy');
    test.skip(
      (await pricePolicy.count()) === 0,
      'The row editor rendered no "Price policy" select, so the per-product policy cannot be ' +
        'diverged from this UI. That select is the multi-variant shared-base control ' +
        '(`bulk-edit-modal.tsx`); a simple product gets direct Price/Stock inputs instead and ' +
        'never emits `pricingPolicy`. Re-check that the chosen fixture really has >1 variant.',
    );
    await pricePolicy.selectOption('markup');
    await expect(
      editor.getByLabel('Markup percent'),
      'switching to markup seeds the default percent, so the policy structurally diverges from ' +
        'the batch `use-master` default',
    ).toHaveValue(String(DIVERGED_PRICING_POLICY.percent));

    const fillable = await fillRequiredFields(page, editor, gtin ?? undefined);
    test.skip(
      !fillable,
      'A required category parameter on this row could not be auto-filled (a dictionary that ' +
        'matched no probe and offers no custom value), so the editor cannot be saved and the ' +
        'policy override never reaches the wire. Pick a fixture whose resolved category has ' +
        'auto-fillable required parameters, or link the variants to a marketplace product card ' +
        '(a card-linked row is exempt from the required-product-parameter gate entirely).',
    );

    await editor.getByRole('button', { name: 'Save all' }).click();
    // A successful save closes the modal; a validation error keeps it open.
    try {
      await expect(editor).toBeHidden({ timeout: 20_000 });
    } catch {
      const errors = await editor.locator('.form-field__error').allInnerTexts();
      throw new Error(
        'The row editor refused to save the diverged Price policy: ' +
          (errors.length > 0 ? errors.join('; ') : '(no field errors surfaced)'),
      );
    }

    // ── (a) the wizard still calls the edited row ready ───────────────────────
    const counts = await waitForReviewSettled(page);
    test.skip(
      counts.attention > 0,
      `The edited row still needs attention (${counts.raw}), so submit is unreachable and the ` +
        'wizard half cannot be asserted. A diverged pricing policy is NOT itself a blocker - ' +
        'something else on this row is unresolved (a required parameter, an image, a category). ' +
        'This test needs a multi-variant product whose row is clearable through the editor.',
    );
    expect(counts.ready, 'the wizard counts the edited row as ready').toBeGreaterThan(0);
    await expect(
      submitCta(page),
      'the wizard enables submit - it considers the batch good to go',
    ).toBeEnabled();

    // PROOF (documentation only - never asserted on): the promise.
    await captureProof(page, 'f15-before-review-ready', { region: reviewRegion(page) });

    await submitCta(page).click();
    await expect(wizard.confirmModalConfirmButton).toBeVisible({ timeout: 30_000 });

    // ── (b) + (c) the server refuses the whole thing ──────────────────────────
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/listings/bulk-create'),
      { timeout: 60_000 },
    );
    await wizard.confirmModalConfirmButton.click();
    const response = await submitted;

    // PROOF (documentation only): the whole-request 400 the confirm modal shows.
    await captureProof(page, 'f15-before-result', {
      region: page.getByRole('dialog').filter({ has: page.locator('.alert--error') }),
      prepare: async () => {
        await expect(page.locator('.alert--error').first()).toBeVisible({ timeout: 15_000 });
      },
    });

    const requestBody: unknown = JSON.parse(response.request().postData() ?? '{}');
    const injected = injectedPolicies(requestBody);
    expect(
      injected.filter((entry) => entry.map === 'perProductOverrides' && entry.field === 'pricingPolicy'),
      'the saved editor stamps `pricingPolicy` at the TOP LEVEL of ' +
        'perProductOverrides[primaryVariantId] - the wizard forwards `row.override` verbatim',
    ).not.toHaveLength(0);

    expect(response.status(), 'the whole request is rejected - not one record is created').toBe(400);
    const messages = messagesOf(await response.json());
    expect(
      messages.join(' | '),
      'the rejection names the exact property the wizard just wrote',
    ).toMatch(/perProductOverrides\[.+\]\.pricingPolicy: property pricingPolicy should not exist/i);

    // The browser stays on the wizard: no batch id was ever minted.
    await expect(page).toHaveURL(/\/listings\/bulk-create\/wizard/);

    testInfo.annotations.push({
      type: 'divergence',
      description:
        `product ${product!.id} (${variants.length} variants): review ${beforeEdit.raw} before ` +
        `the edit, ${counts.raw} after; submitted policies ` +
        `${injected.map((e) => `${e.map}.${e.field}`).join(', ')}; server replied 400 ` +
        messages.join(' | '),
    });
  });
});
