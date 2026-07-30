/**
 * F5 - an Allegro connection with `sellerDefaults` never configured: every row
 * ready, every record terminates SELLER_DEFAULTS_NOT_CONFIGURED
 *
 * ⚠️ CHARACTERIZATION TEST. It passes while the divergence exists and FAILS the
 * moment the finding is closed (or was wrong in the first place). A red run here
 * is a signal to re-read the finding, not a regression in the product.
 *
 * Both sides asserted:
 *
 *   (a) What the wizard presents - nothing at all about seller defaults. There is
 *       no preflight for them: the config step gates only on the shared slice +
 *       the platform section (delivery policy), the review row computes no
 *       blocker from connection config, so rows read `ready` and the submit is
 *       accepted with 202.
 *   (b) What actually happens - `AllegroOfferManagerAdapter.createOffer` runs
 *       `collectMissingSellerDefaultsFields(this.sellerDefaults)` as its FIRST
 *       statement, before `maybeResolveProductCard`, and throws
 *       `OfferCreateRejectedException` with one issue per missing field, code
 *       `SELLER_DEFAULTS_NOT_CONFIGURED`. Every child record terminates `failed`.
 *
 * The audit DOWNGRADED this to low severity, and that downgrade is itself part of
 * the characterization, so this spec asserts the legibility too: the failure is
 * per-record (not a silent batch death), the structured error names the missing
 * field, the message names where to fix it, and the batch-progress table renders
 * both. Test 2 checks that in the browser. Only the FEEDBACK TIMING is wrong -
 * the operator learns after submitting, not before.
 *
 * The gate is all-or-nothing and sits ahead of card resolution, so it blocks even
 * a catalogue-card-linked create where Allegro would inherit GPSR from the card
 * and never read these fields.
 *
 * Reachable state, per the audit's own correction: `sellerDefaults` is
 * `@IsOptional()` on `AllegroConnectionConfigDto`, but its nested `location` /
 * `responsibleProducerId` / `safetyInformation` are all REQUIRED, so a
 * half-saved blob cannot be persisted. "Never configured" is the only reachable
 * failing state - which is what this spec provisions.
 *
 * MUTATION + RESTORE: `sellerDefaults` is temporarily removed from the shared
 * Allegro connection's config (config is replaced wholesale by
 * `ConnectionRepository.update`, so there is no other way to unset a key) and
 * restored in `afterAll`, verified. No marketplace offer is ever created - the
 * gate fires before any Allegro API call - so the only footprint is one failed
 * batch record.
 *
 * @module tests/preflight-divergence
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { BulkBatchSummary, Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import { captureProof } from './__proof__/capture';

/** Request body of `POST /listings/bulk-create` (mirrored locally, #1741 shape). */
interface BulkCreateBody {
  connectionId: string;
  productIds: string[];
  sharedConfig: { stock: number; publishImmediately: boolean };
  perVariantOverrides?: Record<string, { stock?: number; overrides?: Record<string, unknown> }>;
  excludedVariantIds?: string[];
}

/** `BulkBatchRecordSummaryDto` carries `errors[]`; the mirrored type omits it. */
interface RecordErrors {
  field?: string | null;
  code: string;
  message: string;
}
type BatchWithErrors = Omit<BulkBatchSummary, 'records'> & {
  records: Array<BulkBatchSummary['records'][number] & { errors?: RecordErrors[] | null }>;
};

/** Restored in `afterAll` - captured before the config is stripped. */
let originalConfig: Record<string, unknown> | null = null;
let connectionId: string | null = null;
let batchId: string | null = null;

test.describe.configure({ mode: 'serial' });

test.describe('F5 - Allegro sellerDefaults never configured', () => {
  test.afterAll(async ({ api }) => {
    if (connectionId === null || originalConfig === null) return;
    await api.connections.update(connectionId, { config: originalConfig });
    const restored = await api.connections.getById(connectionId);
    expect(
      (restored.config ?? {}).sellerDefaults,
      'the shared Allegro connection MUST leave this spec with its sellerDefaults restored',
    ).toBeTruthy();
  });

  test('rows are ready and the submit is accepted, then every record terminates SELLER_DEFAULTS_NOT_CONFIGURED', async ({
    api,
    world,
    env,
    poll,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'F5 needs an Allegro connection on the stack.');
    const connection = await api.connections.getById(allegro!.id);
    const config = connection.config ?? {};
    test.skip(
      config.sellerDefaults === undefined,
      'F5 provisions the failing state by temporarily REMOVING `sellerDefaults` from the ' +
        'Allegro connection config, so it needs a connection that currently HAS them ' +
        '(otherwise there is nothing to restore afterwards and the stack would be left ' +
        'degraded by this spec).',
    );

    // The seller-defaults gate lives in the ADAPTER, and `OfferBuilderService`
    // runs first: its required-OFFER-section-parameter gate (finding F1) throws
    // PARAMETER_REQUIRED before `createOffer` is ever called. So the fixture must
    // be a row that is genuinely complete - category resolved and every required
    // offer-section parameter supplied, i.e. exactly what an operator gets after
    // filling the row editor. Only such a row proves F5's actual claim: a green,
    // fully-prepared batch still dies, all of it, on connection config.
    const seed = await findBuilderReadyVariant(api, world, env, connection.id);
    test.skip(
      seed === null,
      'F5 needs one master variant that (1) has no Allegro offer mapping yet and (2) resolves ' +
        'to an Allegro category, so its required offer-section parameters can be supplied and ' +
        "the builder's own PARAMETER_REQUIRED gate (F1) does not mask the seller-defaults " +
        'gate. No such variant exists on this stack.',
    );

    // ── Provision: strip sellerDefaults (restored in afterAll) ────────────────
    connectionId = connection.id;
    originalConfig = { ...config };
    const stripped = { ...config };
    delete stripped.sellerDefaults;
    const patched = await api.connections.update(connection.id, { config: stripped });
    expect(
      (patched.config ?? {}).sellerDefaults,
      '`sellerDefaults` is @IsOptional() on the config DTO, so the never-configured state ' +
        'is a legitimately persistable one',
    ).toBeUndefined();

    // (a) The wizard has no preflight for this: the submit is accepted outright.
    const result = await submitBulkCreate(env, {
      connectionId: connection.id,
      productIds: [seed!.variant.id],
      sharedConfig: { stock: 1, publishImmediately: true },
      perVariantOverrides: {
        [seed!.variant.id]: {
          overrides: {
            categoryId: seed!.categoryId,
            parameters: seed!.requiredOfferParamIds.map((id) => ({
              id,
              values: ['1'],
              section: 'offer',
            })),
          },
        },
      },
      excludedVariantIds: [],
    });
    expect(
      result.status,
      `submit is accepted with sellerDefaults missing - 100% green: ${JSON.stringify(result.body)}`,
    ).toBe(202);
    batchId = (result.body as { batchId?: string }).batchId ?? null;
    expect(batchId, 'the accept response carries a batchId').toBeTruthy();

    // (b) …and then every child fails, one by one, at the adapter gate.
    const batch = await poll.until(
      () => api.listings.getBulkBatch(batchId!) as Promise<BatchWithErrors>,
      (b) => b.records.length > 0 && b.records.every((r) => r.status === 'failed'),
      {
        timeoutMs: 180_000,
        intervalMs: 3_000,
        message: 'every offer-creation record in the batch to terminate `failed`',
      },
    );

    expect(
      batch.failedCount,
      'the failure is PER-RECORD and the batch counters terminate (not a stuck batch) - ' +
        'this is why the audit downgraded F5 to low severity',
    ).toBe(batch.totalCount);

    const codes = batch.records.flatMap((r) => (r.errors ?? []).map((e) => e.code));
    expect(
      codes,
      'the terminal reason is the seller-defaults gate, not a generic marketplace rejection',
    ).toContain('SELLER_DEFAULTS_NOT_CONFIGURED');

    const issues = batch.records.flatMap((r) => r.errors ?? []);
    const sellerDefaultIssues = issues.filter((e) => e.code === 'SELLER_DEFAULTS_NOT_CONFIGURED');
    expect(
      sellerDefaultIssues.every((e) => (e.field ?? '') !== ''),
      `each issue names the missing field: ${JSON.stringify(sellerDefaultIssues)}`,
    ).toBe(true);
    expect(
      sellerDefaultIssues[0].message,
      'and the message names where to fix it - legible, just late',
    ).toMatch(/seller-defaults|connection edit page/i);
    expect(
      batch.records.every((r) => r.externalOfferId === null),
      'no Allegro offer was created: the gate is the FIRST statement of createOffer, ahead ' +
        'of catalogue-card resolution and any outbound call',
    ).toBe(true);
  });

  test('the batch progress table renders the reason legibly (the audit downgrade, verified)', async ({
    page,
  }) => {
    test.skip(batchId === null, 'depends on the batch submitted by the test above.');

    await page.goto(`/listings/bulk-batches/${batchId!}`);

    const failedCell = page.locator('.bulk-batch__err').first();
    await expect(
      failedCell,
      'the per-variant row shows the failure message inline, not a bare "failed"',
    ).toBeVisible({ timeout: 30_000 });
    await expect(failedCell).toContainText(/seller-defaults|Responsible Producer|GPSR/i);

    // The structured detail panel carries the code + field, which is the whole
    // basis for calling this "legible but late".
    await page.locator('button[aria-label^="Failure details for"]').first().click();
    const detail = page.locator('.bulk-batch__err-list').first();
    await expect(detail, 'the failure-details panel lists the structured error').toBeVisible({
      timeout: 15_000,
    });

    // PROOF (documentation only - never asserted on): what actually happened to
    // the batch the API accepted without a word about seller defaults. There is
    // no `f05-before-review-ready.png` counterpart: this spec submits through the
    // raw API on purpose, because the wizard has no seller-defaults preflight to
    // photograph (that absence IS the finding).
    await captureProof(page, 'f05-before-result', { fullPage: true });

    await expect(detail).toContainText('SELLER_DEFAULTS_NOT_CONFIGURED');
  });
});

/** A fixture that clears `OfferBuilderService`'s own gates so F5's can be seen. */
interface BuilderReadyVariant {
  variant: ProductVariant;
  categoryId: string;
  /** Required `section: 'offer'` parameter ids the builder gate insists on. */
  requiredOfferParamIds: string[];
}

/**
 * First unmapped single-variant master product whose barcode resolves to an
 * Allegro category, together with that category's required offer-section
 * parameter ids. Single-variant keeps the fan-out at one job; the resolved
 * category + parameters are what let the request reach the adapter at all.
 */
async function findBuilderReadyVariant(
  api: ApiClient,
  world: {
    listProducts(limit?: number): Promise<Product[]>;
    variantsOf(id: string): Promise<ProductVariant[]>;
  },
  env: E2eEnv,
  connectionId_: string,
): Promise<BuilderReadyVariant | null> {
  const mapped = await mappedVariantIds(api, connectionId_);
  const candidates: ProductVariant[] = [];
  for (const product of await world.listProducts(100)) {
    const variants = await world.variantsOf(product.id);
    if (variants.length !== 1) continue;
    const [variant] = variants;
    if (mapped.has(variant.id)) continue;
    if ((variant.ean ?? variant.gtin) === null) continue;
    candidates.push(variant);
  }
  if (candidates.length === 0) return null;

  const resolved = await resolveCategories(
    env,
    connectionId_,
    candidates.map((v) => ({ variantId: v.id, ean: v.ean ?? v.gtin ?? null })),
  );
  for (const variant of candidates) {
    const outcome = resolved[variant.id];
    if (outcome === undefined || outcome.kind !== 'matched') continue;
    const categoryId = outcome.allegroCategoryId;
    if (typeof categoryId !== 'string' || categoryId === '') continue;
    const parameters = await api.listings.categoryParameters(connectionId_, categoryId);
    return {
      variant,
      categoryId,
      requiredOfferParamIds: parameters
        .filter((p) => p.required && p.section === 'offer')
        .map((p) => p.id),
    };
  }
  return null;
}

/** Raw `POST .../categories/resolve-batch` (no `ApiClient` method exists). */
async function resolveCategories(
  env: E2eEnv,
  connectionId_: string,
  items: Array<{ variantId: string; ean: string | null }>,
): Promise<Record<string, { kind: string; allegroCategoryId?: string }>> {
  const token = await loginForRawCalls(env);
  const response = await fetch(
    `${env.apiUrl}/v1/listings/connections/${connectionId_}/categories/resolve-batch`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items }),
    },
  );
  if (!response.ok) return {};
  const body = (await response.json()) as {
    results?: Record<string, { kind: string; allegroCategoryId?: string }>;
  };
  return body.results ?? {};
}

async function mappedVariantIds(api: ApiClient, connectionId_: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await api.listings.list({ connectionId: connectionId_, limit: 100, offset });
    page.items.forEach((mapping) => ids.add(mapping.internalId));
    if (page.items.length === 0 || offset + 100 >= page.total) break;
  }
  return ids;
}

/**
 * Raw `POST /listings/bulk-create`. The node `ApiClient` exposes no bulk-submit
 * method and this suite must not modify `src/`, so the call is issued directly
 * here. Returns status + parsed body rather than throwing.
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
