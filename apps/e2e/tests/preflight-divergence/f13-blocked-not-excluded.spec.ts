/**
 * F13 - an included-but-BLOCKED variant is skipped without being excluded
 *
 * ⚠️ CHARACTERIZATION TEST. It passes while the divergence exists and FAILS the
 * moment the finding is closed (or was wrong in the first place). A red run here
 * is a signal to re-read the finding, not a regression in the product.
 *
 * The divergence, both sides asserted explicitly:
 *
 *   (a) What the wizard presents / emits - `bulk-wizard.tsx` `handleSubmit`
 *       walks each row's variants and routes them into exactly two channels:
 *         if (!v.included)          -> excludedVariantIds.push(v.variantId)
 *         if (v.blockers.length>0)  -> continue        // ← NEITHER channel
 *         else                      -> perVariantOverrides[v.variantId] = …
 *       An included-but-blocked sibling therefore reaches the server in NO
 *       channel at all: not excluded, not overridden, invisible. The only thing
 *       standing between the operator and that submit is the `disabled`
 *       attribute on the review CTA (`canApprove` = includedReady > 0 &&
 *       includedNeedsAttention === 0 && !paramsResolving). There is no guard
 *       inside `handleApproveAll` and none inside `handleSubmit`.
 *
 *   (b) What actually happens - `BulkListingSubmitService.expandVariantJobs`
 *       expands every sibling of a multi-variant product and only skips ids
 *       present in `excludedVariantIds`. The blocked sibling is not there, so a
 *       job + an `OfferCreationRecord` are created for a variant the wizard
 *       itself declared unlistable. There is no server-side equivalent of the
 *       client readiness gate.
 *
 * Why this one is not clickable through a healthy UI: the CTA is disabled in
 * exactly the state that triggers it. So test 1 drives the real browser, invokes
 * the review CTA's own `onClick` directly (clearing the DOM `disabled` attribute
 * is not enough - React gates dispatch on the element's props, which is the
 * finding restated: the barrier is a rendering decision, not a check in the
 * handler), and CAPTURES the request body the wizard actually builds. The POST
 * is aborted at the network layer, so nothing is created. Test 2 then replays
 * that captured body against the live API to observe the server half.
 *
 * F13 is the enabler for F14 (untrimmed master EAN) and F3 (price gates): both
 * stand on the unspoken invariant "every backend job has a per-variant
 * override", which this one `continue` breaks.
 *
 * Fixture requirements (self-skipping): one multi-variant product with at least
 * two variants that carry NO Allegro offer mapping yet - `filterAlreadyListed`
 * drops mapped variants before expansion, which would mask the whole effect.
 *
 * @module tests/preflight-divergence
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import { captureProof, reviewRegion } from './__proof__/capture';

/** Per-variant / per-product override entry of `POST /listings/bulk-create`. */
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
  sharedConfig: {
    stock: number;
    publishImmediately: boolean;
    price?: { amount: number; currency: string };
    overrides?: Record<string, unknown>;
  };
  perProductOverrides?: Record<string, BulkOverride>;
  perVariantOverrides?: Record<string, BulkOverride>;
  excludedVariantIds?: string[];
}

interface Candidate {
  product: Product;
  variants: ProductVariant[];
  /** Variants with no Allegro offer mapping (survive `filterAlreadyListed`). */
  free: ProductVariant[];
}

/** Shared between the two tests in this file (serial by declaration below). */
let capturedBody: BulkCreateBody | null = null;
let blockedVariant: ProductVariant | null = null;
let readyVariant: ProductVariant | null = null;

test.describe.configure({ mode: 'serial' });

test.describe('F13 - blocked variant is skipped but never excluded', () => {
  test('the wizard emits the blocked sibling in NEITHER channel, and only `disabled` guards submit', async ({
    page,
    pages,
    api,
    world,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(
      allegro === undefined,
      'F13 needs an Allegro connection (the wizard destination) on the stack.',
    );
    const connection = allegro!;

    const candidate = await findMultiVariantCandidate(api, world, connection.id, 2);
    test.skip(
      candidate === null,
      'F13 needs a multi-variant master product with >= 2 variants that have NO Allegro ' +
        'offer mapping yet (mapped variants are dropped by `filterAlreadyListed` before ' +
        'expansion, which hides the effect). No such product exists on this stack.',
    );
    const { product, free } = candidate!;

    // The SECOND free variant is the one we force into a blocked state; the
    // first stays ready so `includedReady > 0` and the wizard still submits.
    readyVariant = free[0];
    blockedVariant = free[1];
    const readyEan = barcodeOf(readyVariant);
    const blockedEan = barcodeOf(blockedVariant);
    expect(
      readyEan && blockedEan,
      'both chosen variants need a barcode - the review row anchors on the EAN text',
    ).toBeTruthy();

    // Isolate the ONE blocker under test. Every row in this catalogue also
    // carries Allegro's `needs-product-parameters` blocker (that is finding F1,
    // a different divergence), which would leave zero ready siblings and stop
    // the wizard from submitting at all. Reporting the row's category as having
    // no required product parameters is an ordinary state - plenty of Allegro
    // categories have none - and it changes nothing about the submitted body.
    await page.route('**/listings/connections/*/categories/*/parameters*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        response: await route.fetch(),
        json: { parameters: [] },
      });
    });

    // Force exactly one sibling into `no-match` by rewriting the batch
    // category-resolution response. This is a real, everyday outcome (an EAN
    // that resolves to nothing), and doing it at the wire keeps the master
    // catalogue untouched. Everything else passes through verbatim.
    await page.route('**/listings/connections/*/categories/resolve-batch', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const payload = (await response.json()) as { results: Record<string, unknown> };
      payload.results[blockedVariant!.id] = { kind: 'no-match' };
      await route.fulfill({ response, json: payload });
    });

    // Capture the submit body, then ABORT it. The whole point of test 1 is the
    // shape of the request the wizard builds; aborting keeps the stack clean and
    // sidesteps stubbing a cross-origin 202.
    let submitAttempts = 0;
    await page.route('**/listings/bulk-create', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      submitAttempts += 1;
      const raw = route.request().postData();
      capturedBody = raw === null ? null : (JSON.parse(raw) as BulkCreateBody);
      await route.abort('failed');
    });

    await page.goto(
      `/listings/bulk-create/wizard?productIds=${encodeURIComponent(product.id)}` +
        `&connectionId=${encodeURIComponent(connection.id)}`,
    );

    // ── Config step ──────────────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: 'Configure batch' })).toBeVisible({
      timeout: 30_000,
    });
    // Allegro gates Proceed on its own config section (shipping-rate package);
    // reuse the suite's page object rather than re-deriving the control here.
    await pages.bulkOfferWizard.completePlatformConfig({ requiresDeliveryPolicy: true });
    const proceed = page.getByRole('button', { name: /^Proceed/ });
    await expect(
      proceed,
      'the Allegro config section must settle (delivery policy etc.) before Proceed enables',
    ).toBeEnabled({ timeout: 60_000 });
    await proceed.click();

    // ── Review step ──────────────────────────────────────────────────────────
    const cta = page.locator('button.bulk-review__cta--top');
    await expect(cta).toBeVisible({ timeout: 60_000 });

    // Expand the product so the per-variant rows render.
    await page.locator('button.bulk-review__toggle').first().click();

    const blockedRow = page.locator('.bulk-review__vrow').filter({ hasText: blockedEan! });
    const readyRow = page.locator('.bulk-review__vrow').filter({ hasText: readyEan! });
    await expect(blockedRow, 'the forced-`no-match` variant row renders').toBeVisible({
      timeout: 30_000,
    });

    // (a1) The blocked sibling carries a blocker chip AND is still INCLUDED -
    // the wizard never switches it off, which is precisely why it lands in
    // neither `excludedVariantIds` nor `perVariantOverrides`.
    await expect(
      blockedRow.locator('.bulk-review__c-status'),
      'the forced-`no-match` sibling shows the "manual category" blocker chip',
    ).toContainText(/manual category/i, { timeout: 30_000 });
    await expect(
      blockedRow.locator('input.bulk-review__chk'),
      'the blocked sibling stays INCLUDED (checked) - it is skipped, not excluded',
    ).toBeChecked();
    await expect(
      readyRow.locator('.bulk-review__c-status'),
      'the sibling left alone is ready, so the wizard still has something to submit',
    ).toContainText(/\bready\b/i, { timeout: 30_000 });

    const ctaLabel = (await cta.innerText()).trim();
    test.skip(
      /\(0\)$/.test(ctaLabel),
      `F13 needs at least one READY sibling alongside the blocked one, but the review CTA ` +
        `reads "${ctaLabel}" - the untouched sibling carries blockers of its own on this ` +
        `stack (e.g. missing required product parameters).`,
    );

    // (a2) The ONLY barrier: the CTA's `disabled` attribute.
    await expect(
      cta,
      'with one sibling needing attention the review CTA is disabled - the sole barrier',
    ).toBeDisabled();
    await expect(page.locator('.bulk-review__summary')).toContainText('need attention');

    // PROOF (documentation only - never asserted on): the promise. The blocked
    // sibling is flagged AND still switched on, so it is about to be submitted in
    // neither channel; the CTA's `disabled` attribute is the only barrier.
    await captureProof(page, 'f13-before-review-ready', { region: reviewRegion(page) });

    // Invoke the SAME code path the enabled button would, and watch it sail
    // through. Note what it takes: clearing the DOM `disabled` attribute is not
    // enough, because React decides whether to dispatch `onClick` from the
    // element's PROPS, not the DOM - which is the finding restated. The barrier
    // is entirely a rendering decision; the handler itself
    // (`handleApproveAll`) contains no readiness check at all, so reaching it
    // by any means opens the confirm modal on a batch with a flagged row.
    await cta.evaluate((el) => {
      const propsKey = Object.keys(el).find((key) => key.startsWith('__reactProps$'));
      if (propsKey === undefined) {
        throw new Error('Could not reach the CTA React props handle to invoke its onClick.');
      }
      const props = (el as unknown as Record<string, { onClick?: (event: unknown) => void }>)[
        propsKey
      ];
      if (typeof props.onClick !== 'function') {
        throw new Error('The review CTA carries no onClick handler.');
      }
      props.onClick({});
    });
    const confirmModal = page.getByRole('dialog');
    await expect(
      confirmModal.getByRole('button', { name: 'Create offers' }),
      'no guard in `handleApproveAll`: the confirm modal opens with a flagged row present',
    ).toBeVisible({ timeout: 15_000 });

    // Drafts, not live offers - test 2 replays this exact body for real.
    const publishImmediately = confirmModal.getByRole('checkbox', {
      name: /Publish immediately/,
    });
    if (await publishImmediately.isChecked()) {
      await publishImmediately.uncheck();
    }

    await confirmModal.getByRole('button', { name: 'Create offers' }).click();

    // (a3) No guard in `handleSubmit` either - the request goes out.
    await expect(async () => {
      expect(submitAttempts, 'the wizard issued POST /listings/bulk-create').toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });

    const body = capturedBody;
    expect(body, 'the submit body was captured').not.toBeNull();
    const submitted = body!;

    // (a4) The heart of F13: the blocked sibling is in NO channel.
    expect(
      submitted.excludedVariantIds ?? [],
      'the blocked sibling is NOT in excludedVariantIds - the wizard never tells the server ' +
        'to skip it (contrast: a switched-OFF variant does land here)',
    ).not.toContain(blockedVariant!.id);
    expect(
      Object.keys(submitted.perVariantOverrides ?? {}),
      'the blocked sibling has no per-variant override either - it is simply absent',
    ).not.toContain(blockedVariant!.id);
    expect(
      Object.keys(submitted.perVariantOverrides ?? {}),
      'the ready sibling DOES get a per-variant override',
    ).toContain(readyVariant!.id);
    expect(
      submitted.sharedConfig.price,
      'the wizard never sends a batch-wide price, so an override-less job resolves ' +
        'price = undefined and falls through to the master product price',
    ).toBeUndefined();

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('the backend expands the blocked sibling anyway - no server-side equivalent of the gate', async ({
    api,
    env,
    page,
  }) => {
    test.skip(
      capturedBody === null || blockedVariant === null,
      'depends on the browser test above capturing the wizard submit body.',
    );
    const body: BulkCreateBody = {
      ...capturedBody!,
      sharedConfig: { ...capturedBody!.sharedConfig, publishImmediately: false },
    };

    const result = await submitBulkCreate(env, body);
    expect(
      result.status,
      `the server accepts the body the wizard built: ${JSON.stringify(result.body)}`,
    ).toBe(202);

    const batchId = (result.body as { batchId?: string }).batchId;
    expect(batchId, 'the accept response carries a batchId').toBeTruthy();

    const batch = await api.listings.getBulkBatch(batchId!);
    const recordVariantIds = batch.records.map((r) => r.internalVariantId);

    // PROOF (documentation only): the batch the server minted from that body -
    // one record per sibling, the blocked one included.
    await captureProof(page, 'f13-before-result', {
      fullPage: true,
      prepare: async () => {
        await page.goto(`/listings/bulk-batches/${batchId!}`);
        await expect(page.locator('.bulk-batch__kpi-strip')).toBeVisible({ timeout: 30_000 });
      },
    });

    // (b) The divergence: the server created work for the variant the wizard
    // itself declared unlistable, because the body never said to skip it.
    expect(
      recordVariantIds,
      'the blocked sibling - absent from BOTH client channels - still gets an ' +
        'offer-creation record: `expandVariantJobs` only honours `excludedVariantIds`',
    ).toContain(blockedVariant!.id);
    expect(
      batch.totalCount,
      'totalCount counts the blocked sibling too, so even the batch size the operator ' +
        'is shown includes a variant the wizard refused to approve',
    ).toBeGreaterThanOrEqual(2);
  });
});

/**
 * First multi-variant product with at least `minFree` variants carrying no
 * offer mapping on `connectionId`. Mapped variants are dropped by
 * `filterAlreadyListed` before expansion, so they cannot demonstrate F13.
 */
async function findMultiVariantCandidate(
  api: ApiClient,
  world: { listProducts(limit?: number): Promise<Product[]>; variantsOf(id: string): Promise<ProductVariant[]> },
  connectionId: string,
  minFree: number,
): Promise<Candidate | null> {
  const mapped = await mappedVariantIds(api, connectionId);
  for (const product of await world.listProducts(100)) {
    const variants = await world.variantsOf(product.id);
    if (variants.length < 2) continue;
    const free = variants.filter((v) => !mapped.has(v.id) && barcodeOf(v) !== null);
    if (free.length >= minFree) return { product, variants, free };
  }
  return null;
}

/** Every internal variant id that already has an offer mapping on a connection. */
async function mappedVariantIds(api: ApiClient, connectionId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await api.listings.list({ connectionId, limit: 100, offset });
    page.items.forEach((mapping) => ids.add(mapping.internalId));
    if (page.items.length === 0 || offset + 100 >= page.total) break;
  }
  return ids;
}

function barcodeOf(variant: ProductVariant): string | null {
  return variant.ean ?? variant.gtin ?? null;
}

/**
 * Raw `POST /listings/bulk-create`. The node `ApiClient` exposes no bulk-submit
 * method and this suite must not modify `src/`, so the call is issued directly
 * here. Returns status + parsed body rather than throwing, so a spec can assert
 * on the exact 2xx/4xx.
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
