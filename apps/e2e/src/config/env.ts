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
}

const DEFAULTS = {
  webUrl: 'http://localhost:8090',
  apiUrl: 'http://localhost:3000',
  adminUser: 'admin',
  adminPass: 'admin',
} as const;

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
  };
}
