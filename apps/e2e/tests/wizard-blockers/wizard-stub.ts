/**
 * Bulk-wizard API stub for the category-blocker states (#2240)
 *
 * Every state this project asserts is decided by two inputs - what the resolve
 * pass reports per variant, and what the destination connection declares and
 * carries in its config - so both are supplied here, per test. Everything above
 * them stays the app's own production code: the NDJSON decoder, the blocker
 * computation, the chip vocabulary, the banner copy, the confirm-modal counts.
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
export const CONNECTION_NAME = 'Allegro Demo';
export const MATCHED_CATEGORY_ID = '320851';
export const PICKED_CATEGORY_ID = '316327';
export const PICKED_CATEGORY_NAME = 'Doniczki i skrzynki balkonowe';

/**
 * What the destination catalogue reports for one variant's barcode.
 *
 * `unknown` is the shape of a discriminant added backend-first - the planned
 * `lookup-failed` outcome - which is what the exhaustive branch in
 * `computeBlockers` exists to survive.
 */
export type StubOutcome = 'matched' | 'no-match' | 'multi-match' | 'no-barcode' | 'unknown';

/** One sibling of the product under test. */
export interface StubVariant {
  id: string;
  size: string;
  /** Master barcode. `null` renders the variant barcode-less. */
  ean: string | null;
  outcome: StubOutcome;
}

/**
 * The product from the operator's report: three ceramic pots, one barcode in the
 * destination catalogue and two not. The barcodes are the seeded demo values,
 * which is why exactly one of them matches.
 */
export const VARIANTS: readonly StubVariant[] = [
  { id: 'ol_variant_2240a', size: '20 cm', ean: '5900000000152', outcome: 'no-match' },
  { id: 'ol_variant_2240b', size: '12 cm', ean: '5900000000138', outcome: 'no-match' },
  { id: 'ol_variant_2240c', size: '16 cm', ean: '5900000000145', outcome: 'matched' },
];

/** How a destination declares its taxonomy and its variant grouping. */
export type StubDestinationKind =
  /** Allegro: owns a catalogue, matches by GTIN, allows a per-variant category. */
  | 'catalog-implicit'
  /** Erli: borrows the taxonomy, resolves the category server-side at submit. */
  | 'borrowing'
  /** A marketplace whose grouping forbids a per-variant category. */
  | 'explicit-group';

export interface StubOptions {
  /** Per-variant catalogue outcomes. Defaults to `VARIANTS`. */
  variants?: readonly StubVariant[];
  /** Destination declaration. Defaults to `catalog-implicit`. */
  destination?: StubDestinationKind;
  /**
   * Allegro seller defaults on the destination connection. Omitted ⇒ the
   * connection is incomplete, which is what arms the batch banner: the adapter's
   * own gate is the first statement of `createOffer` and rejects every offer.
   */
  sellerDefaults?: Record<string, unknown>;
  /** Variants the destination already lists (#1837). Defaults to none. */
  publishedVariantIds?: readonly string[];
  /**
   * Required product-section parameters the categories carry. Non-empty ⇒ a
   * card-less variant under a picked category trips `missing parameters`.
   */
  requiredProductParameters?: readonly string[];
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

const CAPABILITIES: Record<StubDestinationKind, string[]> = {
  'catalog-implicit': [
    'OfferManager',
    'OfferCreator',
    'CategoryBrowser',
    'EanCategoryMatcher',
    'EanCategoryMatcherStreaming',
  ],
  // No matcher and no browser: the wizard must read this as "the destination
  // resolves the category itself at submit" and suppress category blockers.
  borrowing: ['OfferManager', 'OfferCreator'],
  'explicit-group': [
    'OfferManager',
    'OfferCreator',
    'CategoryBrowser',
    'EanCategoryMatcher',
    'EanCategoryMatcherStreaming',
  ],
};

const GROUPING: Record<StubDestinationKind, string> = {
  'catalog-implicit': 'catalog-implicit',
  borrowing: 'explicit-group',
  'explicit-group': 'explicit-group',
};

/** Stub every OL route the wizard reads on its way to Review. */
export async function stubWizardApi(page: Page, opts: StubOptions = {}): Promise<void> {
  const now = new Date().toISOString();
  const variants = opts.variants ?? VARIANTS;
  const destination = opts.destination ?? 'catalog-implicit';
  const requiredParams = opts.requiredProductParameters ?? [];

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
        name: CONNECTION_NAME,
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
        supportedCapabilities: CAPABILITIES[destination],
        variantGrouping: GROUPING[destination],
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
      variantCount: variants.length,
      variants: variants.map((v) => ({
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
    json(route, { publishedVariantIds: opts.publishedVariantIds ?? [] })
  );
  await page.route('**/v1/listings/connections/*/categories/*/parameters', (route) =>
    json(route, {
      parameters: requiredParams.map((name, i) => ({
        id: `param-${i}`,
        name,
        type: 'string',
        required: true,
        restrictions: {},
        // Product-section: exactly the kind a catalogue card would have supplied.
        section: 'product',
      })),
    })
  );
  await page.route('**/v1/listings/connections/*/categories/*/path', (route) =>
    json(route, { path: [{ id: MATCHED_CATEGORY_ID, name: 'Doniczki i osłonki' }] })
  );
  // The category picker browses the destination taxonomy through the
  // mapping-options route, so "Set category for all N variants" reaches a real
  // selection rather than an empty modal. One leaf at the root keeps it to a
  // single click.
  await page.route('**/v1/connections/*/mappings/options/source/categories*', (route) =>
    json(route, [
      { id: PICKED_CATEGORY_ID, name: PICKED_CATEGORY_NAME, parentId: null, leaf: true },
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
 *
 * `catalogueLookupPerformed` follows the destination: a borrowing destination
 * consulted nothing, and reporting `true` there would arm exactly the category
 * blockers the wizard must suppress (#1934/F10 in reverse).
 */
export async function stubResolveStream(page: Page, opts: StubOptions = {}): Promise<void> {
  const variants = opts.variants ?? VARIANTS;
  const destination = opts.destination ?? 'catalog-implicit';

  await page.addInitScript(
    ({ variants: vs, matchedCategoryId, catalogueLookupPerformed }) => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes('/categories/resolve-stream')) return nativeFetch(input, init);

        const resultFor = (outcome: string, id: string): unknown => {
          switch (outcome) {
            case 'matched':
              return {
                kind: 'matched',
                allegroCategoryId: matchedCategoryId,
                productCardId: 'card-' + id,
                method: 'auto_detect',
              };
            case 'multi-match':
              return {
                kind: 'multi-match',
                candidates: [
                  { allegroCategoryId: '320851', productCardId: 'card-a', name: 'Pot A' },
                  { allegroCategoryId: '316327', productCardId: 'card-b', name: 'Pot B' },
                ],
              };
            case 'no-barcode':
              return { kind: 'no-ean' };
            case 'unknown':
              // A discriminant this build does not know - the shape a
              // backend-first `lookup-failed` would arrive in.
              return { kind: 'lookup-failed' };
            default:
              return { kind: 'no-match' };
          }
        };

        const lines = vs.map((v) =>
          JSON.stringify({ kind: 'result', variantId: v.id, result: resultFor(v.outcome, v.id) })
        );
        const resolved = vs.filter((v) => v.outcome === 'matched').length;
        lines.push(
          JSON.stringify({
            kind: 'done',
            resolvedCount: resolved,
            unresolvedCount: vs.length - resolved,
            completion: 'complete',
            catalogueLookupPerformed,
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
      variants: variants.map((v) => ({ id: v.id, outcome: v.outcome })),
      matchedCategoryId: MATCHED_CATEGORY_ID,
      catalogueLookupPerformed: destination !== 'borrowing',
    }
  );
}

/** URL that opens the wizard straight on this product + connection. */
export function wizardUrl(): string {
  return `/listings/bulk-create/wizard?productIds=${PRODUCT_ID}&connectionId=${CONNECTION_ID}`;
}
