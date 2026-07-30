/**
 * F7 - duplicate-EAN detection: the backend normalises to GTIN-14, the wizard
 * keys the raw string, and the wizard's batch-wide check never runs batch-wide
 *
 * ⚠️ CHARACTERIZATION TEST. It passes while the divergence exists and FAILS the
 * moment the finding is closed (or was wrong in the first place). A red run here
 * is a signal to re-read the finding, not a regression in the product.
 *
 * Two independent halves, both asserted:
 *
 *   (a) NORMALISATION. `BulkListingSubmitService.enforceIdentifierRules` keys its
 *       seen-set on `ean.padStart(14, '0')` for any GTIN-length value, so
 *       "5901234500012" and "05901234500012" are the SAME identifier and the
 *       second one throws `DuplicateBatchEanException` -> 400 on the whole
 *       request. `duplicateEanVariantIds` (`bulk-policy.ts`) keys the raw trimmed
 *       string, so to the wizard those are two different barcodes and neither row
 *       is flagged. Both forms pass the wizard's own `isValidGtin` and the DTO
 *       regex `^(\d{8}|\d{12,14})$`, so nothing else catches them either.
 *
 *   (b) SCOPE. `duplicateEanVariantIds` takes `rows: BulkWizardRow[]` and its own
 *       docstring says "batch-wide", but the single production call site
 *       (`bulk-edit-modal.tsx`) passes `[oneRow]`. So the check is intra-product
 *       only and its result merely tints a chip inside the row editor - the
 *       review table never surfaces a batch-wide duplicate at all. Test 2 proves
 *       that with two DIFFERENT products whose variants carry a byte-identical
 *       EAN: no normalisation subtlety involved, and still both rows read `ready`.
 *
 * Partially exonerated (do not widen the claim): the PrestaShop master adapter
 * only inherits a product-level EAN onto a variant when
 * `combinations.length === 1`, so "a whole sibling set sharing one EAN" is not
 * reachable from that path.
 *
 * Side effects: none. The identifier gate runs BEFORE
 * `bulkBatchRepository.create`, so the 400 in test 1 persists nothing and creates
 * no marketplace offer. Test 2 is a read-only browser walk that stops at Review.
 *
 * @module tests/preflight-divergence
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';
import { captureProof, reviewRegion } from './__proof__/capture';

/** Per-variant override entry of `POST /listings/bulk-create`. */
interface BulkOverride {
  stock?: number;
  publishImmediately?: boolean;
  overrides?: Record<string, unknown>;
}

/** Request body of `POST /listings/bulk-create` (mirrored locally, #1741 shape). */
interface BulkCreateBody {
  connectionId: string;
  productIds: string[];
  sharedConfig: { stock: number; publishImmediately: boolean };
  perVariantOverrides?: Record<string, BulkOverride>;
  excludedVariantIds?: string[];
}

/** A valid GTIN-13 and its zero-padded GTIN-14 twin (same GS1 check digit). */
const GTIN_13 = '5901234500012';
const GTIN_14 = `0${GTIN_13}`;

test.describe('F7 - duplicate EAN: GTIN-14 normalisation gap + never batch-wide', () => {
  test('the wizard sees two distinct barcodes where the backend sees one duplicate', async ({
    api,
    world,
    env,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'F7 needs an Allegro connection as the wizard destination.');
    const connection = allegro!;

    const free = await findFreeSingleVariants(api, world, connection.id, 2);
    test.skip(
      free.length < 2,
      'F7 needs two master variants of DIFFERENT single-variant products with no Allegro ' +
        'offer mapping yet (mapped variants are dropped by `filterAlreadyListed` before the ' +
        'identifier gate runs, which would surface as an empty-submission 400 instead).',
    );
    const [first, second] = free;

    // (a1) Premise: the wizard's own validator accepts BOTH forms, and its
    // duplicate key is the raw string, so the two are simply not equal.
    expect(isValidGtin(GTIN_13), `${GTIN_13} passes the wizard's GS1 check`).toBe(true);
    expect(isValidGtin(GTIN_14), `${GTIN_14} passes the wizard's GS1 check too`).toBe(true);
    expect(
      GTIN_13,
      'the wizard keys `duplicateEanVariantIds` on the raw trimmed string, and these two ' +
        'strings differ - so no client-side duplicate signal can ever fire for this pair',
    ).not.toBe(GTIN_14);
    expect(
      GTIN_13.padStart(14, '0'),
      'the backend keys on padStart(14) - where the very same pair collapses into one key',
    ).toBe(GTIN_14.padStart(14, '0'));

    // (a2) What actually happens on submit.
    const result = await submitBulkCreate(env, {
      connectionId: connection.id,
      productIds: [first.id, second.id],
      sharedConfig: { stock: 1, publishImmediately: false },
      perVariantOverrides: {
        [first.id]: { overrides: { ean: GTIN_13 } },
        [second.id]: { overrides: { ean: GTIN_14 } },
      },
      excludedVariantIds: [],
    });

    expect(
      result.status,
      `the GTIN-13/GTIN-14 pair is rejected as a duplicate: ${JSON.stringify(result.body)}`,
    ).toBe(400);
    const message = messageOf(result.body);
    expect(
      message,
      'the rejection names the shared barcode - the whole request dies, on variants the ' +
        'review summary never flagged',
    ).toMatch(/shared by more than one included variant/i);
    expect(
      message,
      'and it names the NORMALISED GTIN-14 key, not either string the operator supplied - ' +
        'which is exactly the collapse the wizard cannot see',
    ).toContain(GTIN_14);
  });

  test('two included rows share one EAN and the wizard never says so - the check is not batch-wide', async ({
    page,
    pages,
    world,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'F7 needs an Allegro connection as the wizard destination.');
    const connection = allegro!;

    const pair = await findCrossProductDuplicateEan(world);
    test.skip(
      pair === null,
      'F7 scope half needs two variants of DIFFERENT multi-variant master products carrying ' +
        'the same barcode (the state the wizard cannot see, because its duplicate check is ' +
        'called with a single row). No such pair exists in this catalogue.',
    );
    const { ean, productIds } = pair!;

    await page.goto(
      `/listings/bulk-create/wizard?productIds=${encodeURIComponent(productIds.join(','))}` +
        `&connectionId=${encodeURIComponent(connection.id)}`,
    );

    await expect(page.getByRole('heading', { name: 'Configure batch' })).toBeVisible({
      timeout: 30_000,
    });
    // Allegro gates Proceed on its own config section (shipping-rate package);
    // reuse the suite's page object rather than re-deriving the control here.
    await pages.bulkOfferWizard.completePlatformConfig({ requiresDeliveryPolicy: true });
    const proceed = page.getByRole('button', { name: /^Proceed/ });
    await expect(proceed).toBeEnabled({ timeout: 60_000 });
    await proceed.click();

    const cta = page.locator('button.bulk-review__cta--top');
    await expect(cta).toBeVisible({ timeout: 60_000 });

    // Expand every product row so the per-variant rows (which carry the EAN text)
    // render.
    const toggles = page.locator('button.bulk-review__toggle');
    for (let i = 0; i < (await toggles.count()); i += 1) {
      await toggles.nth(i).click();
    }

    const duplicateRows = page.locator('.bulk-review__vrow').filter({ hasText: ean });
    await expect
      .poll(async () => duplicateRows.count(), {
        message: `both variants carrying EAN ${ean} render as review rows`,
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(2);

    // (b) The divergence: the wizard says NOTHING about the collision. Both rows
    // stay included, and neither carries a duplicate/collision chip - even though
    // the review surface demonstrably CAN render per-variant signals (these rows
    // show unrelated ones, e.g. "add product params" and the soft "already on
    // {destination}" chip). There is simply no batch-wide duplicate signal to
    // render, because `duplicateEanVariantIds` is only ever called with one row.
    // PROOF (documentation only - never asserted on): the promise. Note there is
    // no `f07-before-result.png` counterpart: F7's confirmed half (test 1 above)
    // is a wire-level 400 with no screen of its own, and this scope half never
    // submits.
    await captureProof(page, 'f07-before-review-ready', { region: reviewRegion(page) });

    const count = await duplicateRows.count();
    expect(count, 'both halves of the duplicate pair are on screen').toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i += 1) {
      const row = duplicateRows.nth(i);
      await expect(
        row.locator('input.bulk-review__chk'),
        `row ${i + 1} of the duplicate pair is INCLUDED - both will be submitted together`,
      ).toBeChecked();
      await expect(
        row.locator('.bulk-review__c-status'),
        `row ${i + 1} of the duplicate pair carries no duplicate / shared-barcode chip, though ` +
          'the same cell happily renders other blockers and soft warnings',
      ).not.toContainText(/duplicate|shared|collision/i);
    }
    await expect(
      page.locator('.bulk-review__summary'),
      'nor does the batch summary mention a duplicate barcode anywhere',
    ).not.toContainText(/duplicate|shared barcode/i);
  });
});

/** `count` variants, each the ONLY variant of its product, with no offer mapping. */
async function findFreeSingleVariants(
  api: ApiClient,
  world: {
    listProducts(limit?: number): Promise<Product[]>;
    variantsOf(id: string): Promise<ProductVariant[]>;
  },
  connectionId: string,
  count: number,
): Promise<ProductVariant[]> {
  const mapped = await mappedVariantIds(api, connectionId);
  const found: ProductVariant[] = [];
  for (const product of await world.listProducts(100)) {
    const variants = await world.variantsOf(product.id);
    // Single-variant products only: the fan-out is then exactly one job each, so
    // the pair under test is the entire batch and the 400 can only be theirs.
    if (variants.length !== 1) continue;
    if (mapped.has(variants[0].id)) continue;
    found.push(variants[0]);
    if (found.length === count) break;
  }
  return found;
}

/**
 * Two variants of DIFFERENT products carrying a byte-identical barcode, where
 * both owning products are MULTI-variant. The multi-variant requirement is a
 * rendering constraint, not a semantic one: the review table only renders
 * per-variant rows (`.bulk-review__vrow`, the element that prints the barcode)
 * for an expanded multi-variant product, so a single-variant owner would leave
 * its half of the duplicate pair unassertable.
 */
async function findCrossProductDuplicateEan(world: {
  listProducts(limit?: number): Promise<Product[]>;
  variantsOf(id: string): Promise<ProductVariant[]>;
}): Promise<{ ean: string; productIds: string[] } | null> {
  const byEan = new Map<string, Set<string>>();
  for (const product of await world.listProducts(100)) {
    const variants = await world.variantsOf(product.id);
    if (variants.length < 2) continue;
    for (const variant of variants) {
      const ean = variant.ean ?? variant.gtin;
      if (ean === null || ean === undefined) continue;
      const owners = byEan.get(ean) ?? new Set<string>();
      owners.add(product.id);
      byEan.set(ean, owners);
    }
  }
  for (const [ean, owners] of byEan) {
    if (owners.size >= 2) return { ean, productIds: [...owners].slice(0, 2) };
  }
  return null;
}

async function mappedVariantIds(api: ApiClient, connectionId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await api.listings.list({ connectionId, limit: 100, offset });
    page.items.forEach((mapping) => ids.add(mapping.internalId));
    if (page.items.length === 0 || offset + 100 >= page.total) break;
  }
  return ids;
}

/** `isValidGtin` from `bulk-policy.ts`, transcribed so the premise is asserted. */
function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits[digits.length - 1];
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = body.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += body[i] * (pos % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

function messageOf(body: unknown): string {
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return JSON.stringify(body);
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
