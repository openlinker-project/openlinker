/**
 * E2E environment resolution
 *
 * Single source for every configurable value the suite reads from the
 * environment. Localhost demo-stack defaults are baked in, so an unmodified
 * local stack runs with zero configuration. A `.env` file colocated with this
 * package (gitignored) is loaded on first access without pulling in a `dotenv`
 * dependency, keeping the package's footprint minimal.
 *
 * @module config
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface E2eEnv {
  /** Web SPA base URL (Playwright navigates here). */
  webUrl: string;
  /** REST API base ORIGIN (no `/v1` suffix — the client appends the version). */
  apiUrl: string;
  /** Admin operator username. */
  adminUser: string;
  /** Admin operator password. */
  adminPass: string;
  /**
   * Optional PRE-SEEDED, already-active `viewer` account for the access-control
   * suite. Since #1624 a demo-mode self-registration lands in
   * `pending_confirmation` and cannot log in until the emailed confirmation
   * link is followed — which an API-only test client can never do. When these
   * are set, `provisionViewer` signs in as this existing account instead of
   * registering a throwaway one, keeping the viewer-dependent RBAC / UI /
   * demo-banner assertions live on a demo stack. Unset ⇒ the suite falls back
   * to registration (still the right path in non-demo mode) and skips the
   * viewer cases when the account cannot be activated.
   */
  viewerUser: string | null;
  /** Password for `viewerUser`. Both must be set for the seeded path to engage. */
  viewerPass: string | null;
  /**
   * Optional pinned order id for post-purchase segments (follow-up). Also the
   * shipping suite's order source (`apps/e2e/tests/shipping/**`) — when unset,
   * shipping specs fall back to the latest `ready` order on the stack (e.g.
   * left behind by a prior golden-path run), since the shipping suite never
   * performs its own marketplace purchase.
   */
  orderId: string | null;
  /**
   * Resume the ATTENDED full flow's post-purchase half (S5 onward) against an
   * order that ALREADY exists, given by its OpenLinker internal id
   * (`ol_order_…`). Unset (the default) leaves the flow byte-identical to a
   * normal run — this is a strictly additive path.
   *
   * Why it exists: the full-flow segments run strictly in order and every one
   * after the purchase reads state that S0-S4 build up, so ANY failure before
   * S5 destroys the whole rest of the run. Re-reaching S5 then costs a fresh
   * product, a fresh Allegro offer, roughly 40 minutes waiting for that offer
   * to leave `szkic`, and another human purchase — a price repeatedly paid for
   * failures (stale assertions in S2/S4) that had nothing to do with the
   * post-purchase chain being verified. Point this at an order a previous
   * session already produced and S0-S4 + the purchase PAUSE skip with an
   * explicit reason; the driver product, its variants and the ingested order
   * are seeded from that order instead.
   *
   * What a resumed run CANNOT check: both stock baselines (OL master
   * availability, per-channel offer quantity) are PRE-purchase readings, and
   * the purchase has already happened. Reconstructing one from the post-sale
   * value would make the delta assertion compare a number against itself, so
   * instead the master-stock delta (S7/S9) and the channel/WooCommerce stock
   * checks (S5/S9) are SKIPPED and annotated `resume-degrade` with what went
   * unchecked. Read those annotations before treating a resumed run as
   * equivalent to a full one.
   */
  resumeFromOrder: string | null;
  /**
   * Pin the driver product by SKU (S0 escape hatch). When set, S0 selects this
   * exact product instead of the multi-variant/active-offer heuristic — the
   * deterministic override when the heuristic picks a non-purchasable product.
   */
  productSku: string | null;
  /**
   * Purchase-source marketplace platform (`allegro` | `erli`). The attended
   * purchase, order ingestion (S5), and label dispatch (S6) all target this
   * connection. Defaults to `allegro`; set `E2E_SOURCE_PLATFORM=erli` to run the
   * flow with Erli as the marketplace source.
   */
  sourcePlatform: string;
  /**
   * Marketplaces the operator buys on during the attended purchase pause.
   * Comma-separated (`E2E_PURCHASE_PLATFORMS=allegro,erli`) — each platform
   * gets its own purchase stop, and S5-S9 track one order per platform.
   * Defaults to the single `sourcePlatform`.
   */
  purchasePlatforms: string[];
  /**
   * Opt-in: provision a BRAND-NEW PrestaShop product at the start of the run so
   * every downstream segment exercises the create-paths (fresh offers, fresh
   * order) rather than reusing existing state. Requires `OL_PS_WEBSERVICE_KEY`.
   * Off by default. See docs/manual-testing/e2e-golden-path.md § Fresh product.
   */
  freshProduct: boolean;
  /**
   * How many variants a fresh product is provisioned with. Defaults to **1**.
   *
   * Multi-variant is what S3/S4 conceptually want, but a fresh product's
   * barcodes are SYNTHETIC and Allegro's catalogue has no card for a code it
   * does not know. Verified 2026-07-30: it then MINTS one card, binds it to the
   * first sibling's barcode, and rejects every other sibling with
   * `ProductConstraintViolationException.DataIntegrity` — "Prawidłowa wartość
   * parametru dla produktu to: <first sibling's EAN>". One sibling lists, the
   * rest cannot, so the attended purchase (and S5-S9 behind it) is only reliably
   * reachable with a single variant.
   *
   * Multi-variant listing itself is NOT the blocker — proven the same night by
   * giving one product three DISTINCT barcodes that each already owned a
   * catalogue card: all three siblings listed, each against its own card. Raise
   * this to 2..4 only with barcodes that resolve to distinct existing cards.
   */
  freshVariantCount: number;
  /**
   * PrestaShop category id a fresh product lands in (S0 scripts a PS→Allegro
   * mapping for it so S3 can resolve the category). Defaults to `2` (Home) —
   * the category `PrestashopWebserviceClient.createProduct` assigns by default.
   */
  freshCategoryPsId: string;
  /**
   * Allegro leaf category id the fresh product's PS category maps to (S0
   * scripts the mapping). Defaults to `261481` (Wino bezalkoholowe) - the SAME
   * leaf the default `freshAllegroCategoryPath` breadcrumb resolves to, so a
   * default-config fresh-product run keeps Allegro/Erli category parity.
   *
   * DO NOT change this default without re-verifying that the offer can still be
   * BOUGHT. A fresh product carries a SYNTHETIC barcode (`freshVariantEan`) that
   * is structurally valid but registered with nobody, and Allegro's validator
   * checks the GTIN against the GS1 database per category. `261481` is the one
   * leaf verified to let a synthetic EAN through — an offer created there goes
   * active and is purchasable, which is what makes the attended S5-S9 segments
   * reachable at all.
   *
   * Verified 2026-07-30 that `89508` (children's clothing, 7 required params —
   * an attractive choice when demonstrating parameter fill) does NOT: both
   * sibling offers were created correctly, WITH every required parameter
   * resolved and the Allegro catalogue linked, then stuck in `szkic` with
   * "Podany EAN (GTIN) jest niepoprawny. Podaj EAN (GTIN), który istnieje w
   * bazie GS1." Nothing on our side is wrong in that case — the barcode simply
   * is not real — so the run cannot proceed past the purchase pause. Using a
   * parameter-rich category therefore needs a genuinely GS1-registered EAN,
   * not a generated one.
   */
  freshAllegroCategoryId: string;
  /**
   * Breadcrumb (ancestor names ending at the leaf) for `freshAllegroCategoryId`,
   * used to drive the bulk-wizard `CategoryTreeBrowser` for a borrows-taxonomy
   * destination (Erli) whose category does not auto-resolve. Must lead to the
   * SAME leaf as `freshAllegroCategoryId` so Erli's picked category matches the
   * Allegro row (golden-path parity) and loads that category's parameter schema.
   * Pipe-separated; defaults to the path for the default leaf `261481`
   * (Wino bezalkoholowe). Keep in sync with `freshAllegroCategoryId`.
   */
  freshAllegroCategoryPath: string[];
  /**
   * Optional InPost locker id override for label generation (S6). Used when the
   * buyer-selected pickup point is unusable — Allegro-sandbox lockers are known
   * not to exist in the InPost sandbox.
   */
  paczkomatId: string | null;
  /** Directory holding the `resume` sentinel the manual checkpoints wait on. */
  resumeDir: string;
  /** PrestaShop webservice API key (secret — never exposed by the OL API). */
  psWebserviceKey: string | null;
  /**
   * Optional override for the PrestaShop admin base URL. When unset the spec
   * derives it from the connection's `config.baseUrl` (the tunnel), because
   * `ps_shop_url.domain` is the tunnel and `localhost:8080` 301-redirects.
   */
  psAdminUrl: string | null;
  /** PrestaShop back-office login. */
  psAdminUser: string;
  psAdminPass: string;
  /** WooCommerce REST consumer key/secret (secret — never exposed by the OL API). */
  wcConsumerKey: string | null;
  wcConsumerSecret: string | null;
  /** WooCommerce wp-admin base URL + login. */
  wcAdminUrl: string;
  wcAdminUser: string;
  wcAdminPass: string;
  /**
   * Opt-in flag for the destructive register rate-limit assertion (S: access
   * control). Hammering `POST /auth/register` burns the per-IP demo budget that
   * the other access-control specs share, so the 429 test is skipped unless
   * `E2E_TEST_RATE_LIMIT=true`.
   */
  testRateLimit: boolean;
  /**
   * Opt-in flag for the inbound ShipX status-webhook spec (shipping suite,
   * scenario 8). The real receiver path requires InPost to reach OL's public
   * ingress, which a local/CI stack normally cannot offer without an operator-
   * run tunnel — so the signed-delivery assertion is skipped unless
   * `E2E_TEST_INPOST_WEBHOOK=true` (mirrors `E2E_TEST_RATE_LIMIT`).
   */
  testInpostWebhook: boolean;
  /**
   * Opt-in for the DESTRUCTIVE stale-variant-pruning lifecycle spec (#1495 /
   * #1574): it deletes a real PrestaShop combination via the webservice with no
   * undo. Off by default so an unconfigured run never mutates the catalogue;
   * set `E2E_ALLOW_DESTRUCTIVE_PRUNE=true` on a stack you don't mind losing a
   * variant on (mirrors the `E2E_TEST_RATE_LIMIT` opt-in precedent).
   */
  allowDestructivePrune: boolean;
  /**
   * Direct Postgres connection string, used ONLY by `tests/sales-documents/`
   * (#2563 M10) to seed rows for states no HTTP API can put the stack into on
   * demand — a fabricated order in a country nobody has ordered from yet, in
   * particular. Every other suite in this package reaches the stack through
   * OL's own HTTP API by design — see the package doc comment — so this is a
   * deliberate, narrow exception. Defaults to the plain `demo:up` Postgres
   * (`localhost:5432`); override when a local stack remaps the host port.
   */
  databaseUrl: string;
}

const DEFAULTS = {
  webUrl: 'http://localhost:8090',
  apiUrl: 'http://localhost:3000',
  adminUser: 'admin',
  adminPass: 'admin',
  resumeDir: '.e2e',
  psAdminUser: 'demo@prestashop.com',
  psAdminPass: 'prestashop_demo',
  wcAdminUrl: 'http://localhost:8082/wp-admin',
  wcAdminUser: 'admin',
  wcAdminPass: 'admin123',
  databaseUrl: 'postgres://postgres:postgres@localhost:5432/openlinker',
} as const;

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

let dotenvLoaded = false;

/**
 * Best-effort loader for a package-local `.env`. Only sets keys that are not
 * already present in `process.env`, so real environment variables always win.
 */
function loadDotEnvOnce(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, '../../.env');
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0 && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

/**
 * Resolve the effective E2E environment. Reads `process.env` (after loading a
 * package-local `.env`) and falls back to localhost demo-stack defaults.
 */
export function resolveEnv(): E2eEnv {
  loadDotEnvOnce();

  const orderId = process.env.E2E_ORDER_ID?.trim();

  return {
    webUrl: stripTrailingSlash(process.env.OL_WEB_URL?.trim() || DEFAULTS.webUrl),
    apiUrl: stripTrailingSlash(process.env.OL_API_URL?.trim() || DEFAULTS.apiUrl),
    adminUser: process.env.OL_ADMIN_USER?.trim() || DEFAULTS.adminUser,
    adminPass: process.env.OL_ADMIN_PASS?.trim() || DEFAULTS.adminPass,
    viewerUser: optional(process.env.E2E_VIEWER_USER),
    viewerPass: optional(process.env.E2E_VIEWER_PASS),
    orderId: orderId && orderId.length > 0 ? orderId : null,
    resumeFromOrder: optional(process.env.E2E_RESUME_FROM_ORDER),
    productSku: optional(process.env.E2E_PRODUCT_SKU),
    sourcePlatform: process.env.E2E_SOURCE_PLATFORM?.trim() || 'allegro',
    purchasePlatforms: (process.env.E2E_PURCHASE_PLATFORMS?.trim() || (process.env.E2E_SOURCE_PLATFORM?.trim() || 'allegro'))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    freshProduct: process.env.E2E_FRESH_PRODUCT?.trim() === 'true',
    freshVariantCount: Number.parseInt(process.env.E2E_FRESH_VARIANT_COUNT?.trim() || '1', 10),
    freshCategoryPsId: process.env.E2E_FRESH_CATEGORY_PS?.trim() || '2',
    freshAllegroCategoryId: process.env.E2E_FRESH_ALLEGRO_CATEGORY_ID?.trim() || '261481',
    freshAllegroCategoryPath: (
      process.env.E2E_FRESH_ALLEGRO_CATEGORY_PATH?.trim() ||
      'Supermarket|Produkty spożywcze|Alkohol free|Wino bezalkoholowe'
    )
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    paczkomatId: optional(process.env.E2E_PACZKOMAT_ID),
    resumeDir: process.env.E2E_RESUME_DIR?.trim() || DEFAULTS.resumeDir,
    psWebserviceKey: optional(process.env.OL_PS_WEBSERVICE_KEY),
    psAdminUrl: optional(process.env.OL_PS_ADMIN_URL)
      ? stripTrailingSlash(process.env.OL_PS_ADMIN_URL!.trim())
      : null,
    psAdminUser: process.env.OL_PS_ADMIN_USER?.trim() || DEFAULTS.psAdminUser,
    psAdminPass: process.env.OL_PS_ADMIN_PASS?.trim() || DEFAULTS.psAdminPass,
    wcConsumerKey: optional(process.env.OL_WC_CONSUMER_KEY),
    wcConsumerSecret: optional(process.env.OL_WC_CONSUMER_SECRET),
    wcAdminUrl: stripTrailingSlash(process.env.OL_WC_ADMIN_URL?.trim() || DEFAULTS.wcAdminUrl),
    wcAdminUser: process.env.OL_WC_ADMIN_USER?.trim() || DEFAULTS.wcAdminUser,
    wcAdminPass: process.env.OL_WC_ADMIN_PASS?.trim() || DEFAULTS.wcAdminPass,
    testRateLimit: process.env.E2E_TEST_RATE_LIMIT?.trim() === 'true',
    testInpostWebhook: process.env.E2E_TEST_INPOST_WEBHOOK?.trim() === 'true',
    allowDestructivePrune: process.env.E2E_ALLOW_DESTRUCTIVE_PRUNE?.trim() === 'true',
    databaseUrl: process.env.E2E_DATABASE_URL?.trim() || DEFAULTS.databaseUrl,
  };
}
