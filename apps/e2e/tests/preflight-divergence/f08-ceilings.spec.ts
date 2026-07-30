/**
 * F8 - the two invisible 1000 limits
 *
 * ⚠️ CHARACTERIZATION TEST. It passes while the divergence exists and FAILS the
 * moment the finding is closed (or was wrong in the first place). A red run here
 * is a signal to re-read the finding, not a regression in the product.
 *
 * Scope, precisely (the audit RESCALED this finding - honour the narrowing):
 *
 *   NOT a divergence: the 100-product cap IS mirrored client-side.
 *   `OFFER_PICKER_PRODUCT_CAP = 100` is enforced in `offer-product-picker-modal`
 *   with a visible hint, the wizard page redirects on > 100 ids, and the DTO
 *   carries `@ArrayMaxSize(100)` on `productIds`. Test 1 asserts that mirroring
 *   POSITIVELY, so this file can never be read as claiming otherwise.
 *
 *   The two invisible ones, both keyed to 1000 and neither surfaced anywhere in
 *   the wizard:
 *     1. `EXPANDED_OFFER_CEILING = 1000` in `BulkListingSubmitService`, thrown
 *        from `expandVariantJobs` AFTER exclusions are applied ->
 *        `ExpandedOfferCeilingExceededException` -> 422.
 *     2. `excludedVariantIds` `@ArrayMaxSize(1000)` on the request DTO -> 400.
 *   Version 3 of the audit conflated these two statuses; they are distinct
 *   codes from distinct layers, so test 2 pins the boundary exactly (1000 passes
 *   DTO validation and fails later for an unrelated reason; 1001 never gets past
 *   validation).
 *
 *   The wizard header prints the true variant count ("… · N variants") and never
 *   compares it with 1000. Test 3 asserts no 1000-related hint exists on the
 *   config/review surfaces.
 *
 * Side effects: none. The `@ArrayMaxSize` rejection happens in the validation
 * pipe; the 1000-exclusion control case is engineered to end in
 * `EmptyBulkSubmissionException`, which is thrown before
 * `bulkBatchRepository.create`. Nothing is persisted on any path here.
 *
 * @module tests/preflight-divergence
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';

/** Request body of `POST /listings/bulk-create` (mirrored locally, #1741 shape). */
interface BulkCreateBody {
  connectionId: string;
  productIds: string[];
  sharedConfig: { stock: number; publishImmediately: boolean };
  excludedVariantIds?: string[];
}

/** Both server-side ceilings under test. */
const EXCLUSIONS_CAP = 1000;
const PRODUCT_IDS_CAP = 100;

/** A syntactically valid internal variant id: `/^ol_variant_[a-f0-9]+$/`. */
function syntheticVariantId(index: number): string {
  return `ol_variant_${index.toString(16).padStart(32, '0')}`;
}

test.describe('F8 - invisible 1000 ceilings on expansion and exclusions', () => {
  test('the 100-product cap IS mirrored client-side (this half is NOT a divergence)', async ({
    page,
    world,
    env,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'needs an Allegro connection as the wizard destination.');

    // Client-side half: the wizard page refuses to mount for more than 100 ids
    // and bounces back to /products, so the operator can never even reach a
    // batch that would trip the server cap.
    const tooMany = Array.from({ length: PRODUCT_IDS_CAP + 1 }, (_, i) => syntheticVariantId(i));
    await page.goto(
      `/listings/bulk-create/wizard?productIds=${encodeURIComponent(tooMany.join(','))}` +
        `&connectionId=${encodeURIComponent(allegro!.id)}`,
    );
    await expect
      .poll(() => new URL(page.url()).pathname, {
        message: 'the wizard redirects a >100-product selection back to /products',
        timeout: 30_000,
      })
      .toBe('/products');

    // Server-side half: the same limit exists as `@ArrayMaxSize(100)`, so the two
    // sides agree. Asserted so a future relaxation on one side alone is caught.
    const result = await submitBulkCreate(env, {
      connectionId: allegro!.id,
      productIds: tooMany,
      sharedConfig: { stock: 1, publishImmediately: false },
    });
    expect(
      result.status,
      `>100 productIds is rejected by the DTO too: ${JSON.stringify(result.body)}`,
    ).toBe(400);
  });

  test('the excludedVariantIds cap is 1000, enforced only by the DTO and never surfaced', async ({
    api,
    world,
    env,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'needs an Allegro connection as the wizard destination.');
    const connection = allegro!;

    const seed = await findFreeSingleVariant(api, world, connection.id);
    test.skip(
      seed === null,
      'needs one master variant with no Allegro offer mapping to use as the (self-excluded) ' +
        'seed id, so the control case cannot create a batch.',
    );

    // Control: exactly 1000 exclusions passes DTO validation. The seed variant is
    // itself excluded, so `expandVariantJobs` yields zero jobs and the request
    // dies in `EmptyBulkSubmissionException` - a DIFFERENT 400 from a DIFFERENT
    // layer, which is how we know the array size itself was accepted.
    const atCap = await submitBulkCreate(env, {
      connectionId: connection.id,
      productIds: [seed!.id],
      sharedConfig: { stock: 1, publishImmediately: false },
      excludedVariantIds: [
        seed!.id,
        ...Array.from({ length: EXCLUSIONS_CAP - 1 }, (_, i) => syntheticVariantId(i + 1)),
      ],
    });
    expect(
      atCap.status,
      `exactly ${EXCLUSIONS_CAP} exclusions clears the DTO: ${JSON.stringify(atCap.body)}`,
    ).toBe(400);
    expect(
      messageOf(atCap.body),
      `at the cap the request reaches the service and fails on the empty expansion, i.e. ` +
        `the array size was accepted (proving ${EXCLUSIONS_CAP} is the boundary, not less)`,
    ).toMatch(/at least one productId/i);

    // One over: rejected by `@ArrayMaxSize(1000)` in the validation pipe, before
    // any service code runs.
    const overCap = await submitBulkCreate(env, {
      connectionId: connection.id,
      productIds: [seed!.id],
      sharedConfig: { stock: 1, publishImmediately: false },
      excludedVariantIds: [
        seed!.id,
        ...Array.from({ length: EXCLUSIONS_CAP }, (_, i) => syntheticVariantId(i + 1)),
      ],
    });
    expect(
      overCap.status,
      `${EXCLUSIONS_CAP + 1} exclusions is rejected: ${JSON.stringify(overCap.body)}`,
    ).toBe(400);
    expect(
      messageOf(overCap.body),
      'one over the cap fails in the validation pipe naming excludedVariantIds - a hard ' +
        'limit the wizard neither knows nor shows: it switches variants off without bound',
    ).toMatch(/excludedVariantIds/i);
  });

  test('neither 1000 ceiling is surfaced anywhere in the wizard UI', async ({ page, world }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'needs an Allegro connection as the wizard destination.');

    const product = (await world.listProducts(100)).find((p) => p.id.length > 0);
    test.skip(product === undefined, 'needs at least one master product to open the wizard.');

    await page.goto(
      `/listings/bulk-create/wizard?productIds=${encodeURIComponent(product!.id)}` +
        `&connectionId=${encodeURIComponent(allegro!.id)}`,
    );
    await expect(page.getByRole('heading', { name: 'Configure batch' })).toBeVisible({
      timeout: 30_000,
    });

    // The page description prints the real variant count. What it never does is
    // compare it against anything: no "of 1000", no remaining-budget hint, no
    // warning band. So an operator whose selection expands past 1000 variants
    // learns about the ceiling from a 422 after clicking.
    const body = await page.locator('body').innerText();
    expect(body, 'the wizard reports the batch size in variants').toMatch(/\bvariants?\b/i);
    expect(
      body,
      'no 1000 / 1,000 ceiling is mentioned on the config surface - both limits are ' +
        'invisible until the submit fails',
    ).not.toMatch(/1[,.\s]?000/);
  });

  test('the expansion ceiling (422) is unprovisionable on this stack', async ({ world }) => {
    const products = await world.listProducts(100);
    let variantTotal = 0;
    let largestFanOut = 0;
    for (const product of products) {
      const variants = await world.variantsOf(product.id);
      variantTotal += variants.length;
      largestFanOut = Math.max(largestFanOut, variants.length);
    }
    test.skip(
      true,
      `BLOCKED ON FIXTURE. Tripping EXPANDED_OFFER_CEILING needs a selection that expands to ` +
        `more than ${EXCLUSIONS_CAP} sibling variants AFTER exclusions. The expansion walks ` +
        `the distinct variants of the selected products, and \`productIds\` is itself capped ` +
        `at ${PRODUCT_IDS_CAP}, so the reachable maximum here is the whole catalogue: this ` +
        `stack exposes ${variantTotal} variants across ${products.length} products (largest ` +
        `single product fan-out: ${largestFanOut}). Reproducing it needs a seeded catalogue ` +
        `with > ${EXCLUSIONS_CAP} variants concentrated in <= ${PRODUCT_IDS_CAP} products ` +
        `(e.g. 100 products x 11 combinations), which requires bulk PrestaShop/WooCommerce ` +
        `provisioning this suite does not have (OL_PS_WEBSERVICE_KEY is unset by default and ` +
        `the webservice helper cannot create combinations).`,
    );
  });
});

/** First master variant that is the only variant of its product and unmapped. */
async function findFreeSingleVariant(
  api: ApiClient,
  world: {
    listProducts(limit?: number): Promise<Product[]>;
    variantsOf(id: string): Promise<ProductVariant[]>;
  },
  connectionId: string,
): Promise<ProductVariant | null> {
  const mapped = await mappedVariantIds(api, connectionId);
  for (const product of await world.listProducts(100)) {
    const variants = await world.variantsOf(product.id);
    if (variants.length !== 1) continue;
    if (!mapped.has(variants[0].id)) return variants[0];
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
