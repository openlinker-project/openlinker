/**
 * Bulk-wizard API stub for the category-blocker states (#2240)
 *
 * The states this project asserts are decided entirely by what the resolve pass
 * reports per variant and by what the destination connection carries in its
 * config, so both are supplied here and everything above them - the blocker
 * computation, the chip vocabulary, the banner copy, the confirm-modal counts -
 * stays the app's own production code.
 *
 * Two deliberate differences from the `perf` project's stub
 * (`tests/perf/resolve-stream-stub.ts`), which paces an NDJSON body to measure
 * progress:
 *
 * - outcomes are per VARIANT, not per product, because the defect under test is
 *   one product whose siblings resolve differently;
 * - the body is written in one go, because nothing here measures latency and a
 *   paced stream would only add flake.
 *
 * The stream is installed as a `window.fetch` patch rather than `page.route`
 * for the same reason the perf stub is: the client reads the response as a
 * stream, and `route.fulfill` cannot produce one.
 *
 * @module tests/wizard-blockers
 */
import type { Page, Route } from '@playwright/test';

export const CONNECTION_ID = '00000000-0000-4000-8000-000000002240';
export const MASTER_CONNECTION_ID = '00000000-0000-4000-8000-000000002241';
export const PRODUCT_ID = 'ol_product_2240terra';
export const MATCHED_CATEGORY_ID = '320851';
export const PICKED_CATEGORY_ID = '316327';

/** One sibling of the product under test. */
export interface StubVariant {
  id: string;
  size: string;
  ean: string;
  /** What the destination catalogue reports for this variant's barcode. */
  outcome: 'matched' | 'no-match';
}

/**
 * The product from the operator's report: three ceramic pots, one barcode in the
 * destination catalogue and two not. Barcodes are the seeded demo values, which
 * is why one of them matches and two do not.
 */
export const VARIANTS: readonly StubVariant[] = [
  { id: 'ol_variant_2240a', size: '20 cm', ean: '5900000000152', outcome: 'no-match' },
  { id: 'ol_variant_2240b', size: '12 cm', ean: '5900000000138', outcome: 'no-match' },
  { id: 'ol_variant_2240c', size: '16 cm', ean: '5900000000145', outcome: 'matched' },
];

export interface StubOptions {
  /**
   * Allegro seller defaults on the destination connection. Omitted ⇒ the
   * connection is incomplete, which is what arms the batch banner: the adapter's
   * own gate is the first statement of `createOffer` and rejects every offer.
   */
  sellerDefaults?: Record<string, unknown>;
}

const json = (route: Route, body: unknown): Promise<void> =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Every permission the wizard's write affordances gate on. Stubbed rather than
 * borrowed from the `setup` project's storage state, which is what makes this
 * project hermetic: the states under test are decided by resolve outcomes and
 * connection config, so a real session would add a stack dependency and a shared
 * auth artifact without making a single assertion more truthful.
 */
const SESSION_PERMISSIONS = [
  'listings:read',
  'listings:write',
  'products:read',
  'connections:read',
  'connections:write',
  'inventory:read',
];

/** Stub every OL route the wizard reads on its way to Review. */
export async function stubWizardApi(page: Page, opts: StubOptions = {}): Promise<void> {
  const now = new Date().toISOString();

  // Session bootstrap: the adapter refreshes, then reads `/auth/me`.
  await page.route('**/v1/auth/refresh', (route) =>
    json(route, { access_token: 'e2e-wizard-blockers-token' })
  );
  await page.route('**/v1/auth/me', (route) =>
    json(route, {
      id: 'usr_e2e_2240',
      username: 'e2e-operator',
      email: 'e2e-operator@openlinker.local',
      role: 'admin',
      permissions: SESSION_PERMISSIONS,
      analyticsConsent: false,
    })
  );
  // Anything else the shell polls on boot resolves empty rather than 404-looping.
  await page.route('**/v1/system/**', (route) => json(route, {}));

  await page.route('**/v1/connections', (route) =>
    json(route, [
      {
        id: CONNECTION_ID,
        name: 'Allegro Demo',
        platformType: 'allegro',
        status: 'active',
        // Configure blocks without a master catalogue (#1934/F4).
        config: {
          masterCatalogConnectionId: MASTER_CONNECTION_ID,
          ...(opts.sellerDefaults ? { sellerDefaults: opts.sellerDefaults } : {}),
        },
        credentialsBacked: true,
        adapterKey: 'allegro.publicapi.v1',
        enabledCapabilities: ['OfferManager'],
        supportedCapabilities: [
          'OfferManager',
          'OfferCreator',
          'CategoryBrowser',
          'EanCategoryMatcher',
          'EanCategoryMatcherStreaming',
        ],
        variantGrouping: 'catalog-implicit',
        defaultRateLimit: null,
        createdAt: now,
        updatedAt: now,
      },
    ])
  );

  await page.route(`**/v1/products/${PRODUCT_ID}*`, (route) =>
    json(route, {
      id: PRODUCT_ID,
      name: 'Doniczka ceramiczna Terra',
      sku: 'TERRA-POT',
      price: 39,
      currency: 'PLN',
      description: 'Ceramic pot.',
      images: ['https://example.invalid/pot.jpg'],
      categories: ['14'],
      features: [],
      createdAt: now,
      updatedAt: now,
      variantCount: VARIANTS.length,
      variants: VARIANTS.map((v) => ({
        id: v.id,
        productId: PRODUCT_ID,
        sku: `TERRA-${v.size.replace(' ', '')}`,
        attributes: { Rozmiar: v.size },
        ean: v.ean,
        gtin: null,
        price: 39,
        createdAt: now,
        updatedAt: now,
      })),
      externalIds: [],
    })
  );

  await page.route('**/v1/listings/connections/*/seller-policies', (route) =>
    json(route, {
      deliveryPolicies: [{ id: 'dp-1', name: 'Standard delivery' }],
      returnPolicies: [{ id: 'rp-1', name: 'Standard returns' }],
      warranties: [],
      impliedWarranties: [],
    })
  );
  await page.route('**/v1/listings/connections/*/responsible-producers', (route) =>
    json(route, { producers: [] })
  );
  await page.route('**/v1/listings/connections/*/delivery-price-lists', (route) =>
    json(route, { priceLists: [] })
  );
  await page.route('**/v1/listings/published-variants', (route) =>
    json(route, { publishedVariantIds: [] })
  );
  await page.route('**/v1/listings/connections/*/categories/*/parameters', (route) =>
    json(route, { parameters: [] })
  );
  await page.route('**/v1/listings/connections/*/categories/*/path', (route) =>
    json(route, { path: [{ id: MATCHED_CATEGORY_ID, name: 'Doniczki i osłonki' }] })
  );
  // The category picker browses the destination taxonomy projection through the
  // mapping-options route, so "Set category for all N variants" reaches a real
  // selection rather than an empty modal. One leaf at the root keeps it to a
  // single click.
  await page.route('**/v1/connections/*/mappings/options/source/categories*', (route) =>
    json(route, [
      { id: PICKED_CATEGORY_ID, name: 'Doniczki i skrzynki balkonowe', parentId: null, leaf: true },
    ])
  );
  await page.route('**/v1/inventory/availability*', (route) => {
    const ids = (new URL(route.request().url()).searchParams.get('productVariantIds') ?? '')
      .split(',')
      .filter((s) => s.length > 0);
    return json(route, {
      items: ids.map((id) => ({ productVariantId: id, totalAvailable: 8, locationCount: 1 })),
    });
  });
}

/**
 * Patch `window.fetch` for the resolve stream, reporting one line per variant
 * with that variant's own outcome plus the terminal line the reducer waits for.
 */
export async function stubResolveStream(page: Page): Promise<void> {
  await page.addInitScript(
    ({ variants, matchedCategoryId }) => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes('/categories/resolve-stream')) return nativeFetch(input, init);

        const lines = variants.map((v) =>
          JSON.stringify({
            kind: 'result',
            variantId: v.id,
            result:
              v.outcome === 'matched'
                ? {
                    kind: 'matched',
                    allegroCategoryId: matchedCategoryId,
                    productCardId: 'card-' + v.id,
                    method: 'auto_detect',
                  }
                : { kind: 'no-match' },
          })
        );
        const resolved = variants.filter((v) => v.outcome === 'matched').length;
        lines.push(
          JSON.stringify({
            kind: 'done',
            resolvedCount: resolved,
            unresolvedCount: variants.length - resolved,
            completion: 'complete',
            catalogueLookupPerformed: true,
          })
        );

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(lines.join('\n') + '\n'));
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        });
      };
    },
    {
      variants: VARIANTS.map((v) => ({ id: v.id, outcome: v.outcome })),
      matchedCategoryId: MATCHED_CATEGORY_ID,
    }
  );
}

/** URL that opens the wizard straight on this product + connection. */
export function wizardUrl(): string {
  return `/listings/bulk-create/wizard?productIds=${PRODUCT_ID}&connectionId=${CONNECTION_ID}`;
}
