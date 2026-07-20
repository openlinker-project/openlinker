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
  /** Optional pinned order id for post-purchase segments (follow-up). */
  orderId: string | null;
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
   * Opt-in for the DESTRUCTIVE stale-variant-pruning lifecycle spec (#1495 /
   * #1574): it deletes a real PrestaShop combination via the webservice with no
   * undo. Off by default so an unconfigured run never mutates the catalogue;
   * set `E2E_ALLOW_DESTRUCTIVE_PRUNE=true` on a stack you don't mind losing a
   * variant on (mirrors the `E2E_TEST_RATE_LIMIT` opt-in precedent).
   */
  allowDestructivePrune: boolean;
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
    orderId: orderId && orderId.length > 0 ? orderId : null,
    productSku: optional(process.env.E2E_PRODUCT_SKU),
    sourcePlatform: process.env.E2E_SOURCE_PLATFORM?.trim() || 'allegro',
    purchasePlatforms: (process.env.E2E_PURCHASE_PLATFORMS?.trim() || (process.env.E2E_SOURCE_PLATFORM?.trim() || 'allegro'))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    freshProduct: process.env.E2E_FRESH_PRODUCT?.trim() === 'true',
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
    allowDestructivePrune: process.env.E2E_ALLOW_DESTRUCTIVE_PRUNE?.trim() === 'true',
  };
}
