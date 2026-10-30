/**
 * G11 stack setup file (#3591)
 *
 * The stack agent writes one JSON file describing the stand the G11 suite runs
 * against, and every spec reads it from here. There is no other source for
 * connection ids, catalogue ids or the Postgres container, so a missing file
 * is a hard error with a message naming the path, never a silent skip that
 * would read as a green run of nothing.
 *
 * Location: `E2E_G11_SETUP`, default `~/.cache/g11/e2e/setup.json`.
 *
 * Optional blocks (a product, a connection) make the scenarios that need them
 * skip with a reason; the required core is `urls`, `usersFile` and
 * `postgresContainer`.
 *
 * @module support/g11
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface G11VariantRef {
  /** OpenLinker internal variant id (`ol_variant_*`). */
  variantId: string;
  sku: string;
}

export interface G11ProductRef {
  /** OpenLinker internal product id (`ol_product_*`). */
  productId: string;
  name?: string;
  /** Keyed by the scenario handle (`A1`, `A2`, `B1`, ...). */
  variants: Record<string, G11VariantRef>;
}

export interface G11Setup {
  urls: {
    web: string;
    api: string;
    prestashop?: string;
    woocommerce?: string;
  };
  connections: {
    /** OpenLinker connection id of the PrestaShop order source. */
    prestashop?: string;
    /** OpenLinker connection id of the WooCommerce order source. */
    woocommerce?: string;
  };
  products: {
    /** PrestaShop product with 2 combinations, each with its OWN picture (A1, A2). */
    psA?: G11ProductRef;
    /** PrestaShop product whose single combination has NO picture of its own (B1). */
    psB?: G11ProductRef;
    /** PrestaShop product that never gets a cost and is never sold (C1). */
    psC?: G11ProductRef;
    /** WooCommerce variable product: `withImage`, `withoutImage`. */
    wooVariable?: G11ProductRef;
    /** Product whose catalogue currency is EUR (E1) - for `currency-mismatch`. */
    wooEur?: G11ProductRef;
  };
  /** JSON file: `{ admin, operator, viewer, packer }`, each `{ username, password }`. */
  usersFile: string;
  /** Docker container name of the stack's Postgres (used through `docker exec ... psql`). */
  postgresContainer: string;
  db?: { user?: string; name?: string };
  /** Docker container of the API, only to sample its memory around the CSV-7 export. */
  apiContainer?: string;
  /** Optional overlay for the source-shop secrets; real env vars win. */
  secrets?: {
    psWebserviceKey?: string;
    psAdminUrl?: string;
    wcConsumerKey?: string;
    wcConsumerSecret?: string;
  };
  /**
   * Optional window (`yyyy-mm-dd`) holding only sales of variants without a
   * cost, for the `missing-cost` state. Without it that state is probed on the
   * default 30-day range and skipped when the stand has costs.
   */
  noCostRange?: { from: string; to: string };
}

export type G11Role = 'admin' | 'operator' | 'viewer' | 'packer';

export interface G11Credentials {
  username: string;
  password: string;
}

export type G11Users = Record<G11Role, G11Credentials>;

export function setupFilePath(): string {
  const configured = process.env.E2E_G11_SETUP?.trim();
  return configured && configured.length > 0
    ? configured.replace(/^~(?=$|\/)/, homedir())
    : resolve(homedir(), '.cache/g11/e2e/setup.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadSetup(): G11Setup {
  const path = setupFilePath();
  if (!existsSync(path)) {
    throw new Error(
      `G11 e2e setup file not found: ${path}. The stack agent writes it ` +
        '(urls, connections, products, usersFile, postgresContainer); point E2E_G11_SETUP at it.',
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`G11 e2e setup file ${path} is not a JSON object`);
  }
  const missing = ['urls', 'usersFile', 'postgresContainer'].filter((key) => parsed[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`G11 e2e setup file ${path} is missing required field(s): ${missing.join(', ')}`);
  }
  const setup = parsed as unknown as G11Setup;
  setup.connections = setup.connections ?? {};
  setup.products = setup.products ?? {};
  return setup;
}

export function loadUsers(setup: G11Setup): G11Users {
  const path = setup.usersFile.replace(/^~(?=$|\/)/, homedir());
  if (!existsSync(path)) {
    throw new Error(`G11 users file not found: ${path} (setup.usersFile)`);
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`G11 users file ${path} is not a JSON object`);
  }
  for (const role of ['admin', 'operator', 'viewer', 'packer'] as const) {
    const entry = parsed[role];
    if (!isRecord(entry) || typeof entry.username !== 'string' || typeof entry.password !== 'string') {
      throw new Error(`G11 users file ${path} has no {username,password} for role "${role}"`);
    }
  }
  return parsed as unknown as G11Users;
}

/** Real env vars win over the setup file's `secrets` overlay. */
export function applySecretsToEnv(setup: G11Setup): void {
  const overlay: Array<[string, string | undefined]> = [
    ['OL_PS_WEBSERVICE_KEY', setup.secrets?.psWebserviceKey],
    ['OL_PS_ADMIN_URL', setup.secrets?.psAdminUrl ?? setup.urls.prestashop],
    ['OL_PS_HOST_HEADER', 'localhost:8080'],
    ['OL_WC_CONSUMER_KEY', setup.secrets?.wcConsumerKey],
    ['OL_WC_CONSUMER_SECRET', setup.secrets?.wcConsumerSecret],
  ];
  for (const [key, value] of overlay) {
    if (value && !process.env[key]) process.env[key] = value;
  }
}
