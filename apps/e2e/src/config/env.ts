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
  };
}
