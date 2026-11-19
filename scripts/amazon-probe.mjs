#!/usr/bin/env node
/**
 * Amazon SP-API capability probes (#4187)
 *
 * Asks Amazon one read-only question per capability the Amazon integration uses
 * and prints what each call answered, so the next person working on the
 * integration can see what the static sandbox and a live account return.
 *
 * Read-only: no call creates, changes or deletes anything (the MCF preview only
 * asks whether an order could be fulfilled). Never run in CI: it needs the
 * credentials of an app an operator registered.
 *
 * Output is the SHAPE of each answer (keys, array lengths, value types), never
 * the values: on a live account an order answer carries buyer data, and nothing
 * here should put that in a terminal or a CI log. `--values` prints the raw
 * answer instead and is refused outside the sandbox, whose data is canned.
 *
 * Usage:
 *   AMAZON_CLIENT_ID=... AMAZON_CLIENT_SECRET=... AMAZON_REFRESH_TOKEN=... \
 *   AMAZON_ENVIRONMENT=sandbox pnpm amazon:probe [--values] [--only=orders,listings]
 *
 * Optional: AMAZON_REGION (eu|na|fe, default eu), AMAZON_MARKETPLACE_ID (default
 * DE), AMAZON_SELLER_ID (merchant token, for listings), AMAZON_SKU (a listing
 * SKU), AMAZON_EAN (a barcode for the catalogue probe).
 */

const HOSTS = {
  production: { eu: 'sellingpartnerapi-eu.amazon.com', na: 'sellingpartnerapi-na.amazon.com', fe: 'sellingpartnerapi-fe.amazon.com' },
  sandbox: {
    eu: 'sandbox.sellingpartnerapi-eu.amazon.com',
    na: 'sandbox.sellingpartnerapi-na.amazon.com',
    fe: 'sandbox.sellingpartnerapi-fe.amazon.com',
  },
};
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const NOTIFICATIONS_SCOPE = 'sellingpartnerapi::notifications';

const args = process.argv.slice(2);
const showValues = args.includes('--values');
const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length).split(',');

const env = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
};

const config = {
  clientId: env('AMAZON_CLIENT_ID'),
  clientSecret: env('AMAZON_CLIENT_SECRET'),
  refreshToken: env('AMAZON_REFRESH_TOKEN'),
  environment: env('AMAZON_ENVIRONMENT', 'sandbox'),
  region: env('AMAZON_REGION', 'eu'),
  marketplaceId: env('AMAZON_MARKETPLACE_ID', 'A1PA6795UKMFR9'),
  sellerId: env('AMAZON_SELLER_ID'),
  sku: env('AMAZON_SKU'),
  ean: env('AMAZON_EAN', '5901234123457'),
};

function fail(message) {
  process.stderr.write(`amazon-probe: ${message}\n`);
  process.exit(1);
}

if (!config.clientId || !config.clientSecret || !config.refreshToken) {
  fail('set AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET and AMAZON_REFRESH_TOKEN (the private app\'s LWA credentials)');
}
if (showValues && config.environment !== 'sandbox') {
  fail('--values prints raw answers and is only allowed with AMAZON_ENVIRONMENT=sandbox: live answers carry buyer data');
}
const host = HOSTS[config.environment]?.[config.region];
if (!host) {
  fail(`unknown AMAZON_ENVIRONMENT "${config.environment}" or AMAZON_REGION "${config.region}"`);
}

/** An LWA access token; grantless (client credentials) when `scope` is given. */
async function accessToken(scope) {
  const body = new URLSearchParams(
    scope
      ? { grant_type: 'client_credentials', scope, client_id: config.clientId, client_secret: config.clientSecret }
      : {
          grant_type: 'refresh_token',
          refresh_token: config.refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        },
  );
  // eslint-disable-next-line no-restricted-globals -- standalone developer probe, outside the host transport
  const response = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || typeof json.access_token !== 'string') {
    // The error text names the problem (invalid_grant, invalid_client), never the secret.
    throw new Error(`LWA token request answered ${response.status} ${json.error ?? ''} ${json.error_description ?? ''}`.trim());
  }
  return json.access_token;
}

async function call(token, method, path, query = {}, body) {
  const url = new URL(`https://${host}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  // eslint-disable-next-line no-restricted-globals -- standalone developer probe, outside the host transport
  const response = await fetch(url, {
    method,
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
      'User-Agent': 'OpenLinker-amazon-probe/1.0',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = text.slice(0, 200);
  }
  return { status: response.status, requestId: response.headers.get('x-amzn-requestid'), json };
}

/** The structure of a value without its contents. */
function shape(value, depth = 0) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return depth > 4 ? `array(${value.length})` : [`${value.length} item(s), first:`, shape(value[0], depth + 1)];
  }
  if (typeof value === 'object') {
    if (depth > 4) return 'object';
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner, depth + 1)]));
  }
  return typeof value;
}

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** One read-only question per capability. `needs` names the env value a probe cannot run without. */
const PROBES = [
  {
    id: 'participations',
    capability: 'connection test',
    run: (token) => call(token, 'GET', '/sellers/v1/marketplaceParticipations'),
  },
  {
    id: 'orders',
    capability: 'OrderSource (order feed)',
    run: (token) =>
      call(token, 'GET', '/orders/2026-01-01/orders', {
        marketplaceIds: [config.marketplaceId],
        lastUpdatedAfter: daysAgo(7),
        maxResultsPerPage: 5,
      }),
  },
  {
    id: 'listings',
    capability: 'OfferManager / ProductMaster / InventoryMaster (FBM stock)',
    needs: 'AMAZON_SELLER_ID',
    run: (token) =>
      call(token, 'GET', `/listings/2021-08-01/items/${encodeURIComponent(config.sellerId)}`, {
        marketplaceIds: [config.marketplaceId],
        includedData: ['summaries', 'attributes', 'fulfillmentAvailability', 'relationships'],
        pageSize: 5,
      }),
  },
  {
    id: 'listing',
    capability: 'OfferManager (one listing)',
    needs: 'AMAZON_SELLER_ID and AMAZON_SKU',
    run: (token) =>
      call(token, 'GET', `/listings/2021-08-01/items/${encodeURIComponent(config.sellerId)}/${encodeURIComponent(config.sku)}`, {
        marketplaceIds: [config.marketplaceId],
        includedData: ['summaries', 'offers', 'fulfillmentAvailability', 'issues'],
      }),
  },
  {
    id: 'catalog',
    capability: 'EanCategoryMatcher / CatalogProductReader',
    run: (token) =>
      call(token, 'GET', '/catalog/2022-04-01/items', {
        marketplaceIds: [config.marketplaceId],
        identifiers: [config.ean],
        identifiersType: 'EAN',
        includedData: ['summaries', 'productTypes', 'identifiers'],
      }),
  },
  {
    id: 'product-types',
    capability: 'CategoryBrowser (product types)',
    run: (token) => call(token, 'GET', '/definitions/2020-09-01/productTypes', { marketplaceIds: [config.marketplaceId] }),
  },
  {
    id: 'notifications',
    capability: 'order notifications (SQS destinations, grantless)',
    grantless: NOTIFICATIONS_SCOPE,
    run: (token) => call(token, 'GET', '/notifications/v1/destinations'),
  },
  {
    id: 'fba-inventory',
    capability: 'InventoryMaster (FBA stock)',
    run: (token) =>
      call(token, 'GET', '/fba/inventory/v1/summaries', {
        details: 'true',
        granularityType: 'Marketplace',
        granularityId: config.marketplaceId,
        marketplaceIds: [config.marketplaceId],
      }),
  },
  {
    id: 'returns-reports',
    capability: 'ReturnSourceReader (returns reports already built)',
    run: (token) =>
      call(token, 'GET', '/reports/2021-06-30/reports', {
        reportTypes: ['GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE'],
        pageSize: 5,
      }),
  },
  {
    id: 'mcf-preview',
    capability: 'FulfillmentExecutor (MCF preview, creates nothing)',
    needs: 'AMAZON_SKU',
    run: (token) =>
      call(token, 'POST', '/fba/outbound/2020-07-01/fulfillmentOrders/preview', {}, {
        marketplaceId: config.marketplaceId,
        address: { name: 'Probe', addressLine1: 'Probe 1', city: 'Berlin', postalCode: '10115', countryCode: 'DE' },
        items: [{ sellerSku: config.sku, sellerFulfillmentOrderItemId: 'probe-1', quantity: 1 }],
      }),
  },
];

function missing(probe) {
  if (!probe.needs) return null;
  const names = probe.needs.split(' and ');
  return names.some((name) => !process.env[name]?.trim()) ? probe.needs : null;
}

async function main() {
  process.stdout.write(`Amazon SP-API probes: ${config.environment}, ${host}, marketplace ${config.marketplaceId}\n\n`);
  const tokens = new Map();
  const tokenFor = async (scope) => {
    const key = scope ?? 'seller';
    if (!tokens.has(key)) tokens.set(key, await accessToken(scope));
    return tokens.get(key);
  };

  let failures = 0;
  for (const probe of PROBES) {
    if (only && !only.includes(probe.id)) continue;
    const absent = missing(probe);
    if (absent) {
      process.stdout.write(`- ${probe.id} (${probe.capability}): skipped, set ${absent}\n\n`);
      continue;
    }
    try {
      const token = await tokenFor(probe.grantless);
      const { status, requestId, json } = await probe.run(token);
      if (status >= 400) failures += 1;
      process.stdout.write(`- ${probe.id} (${probe.capability}): HTTP ${status}${requestId ? `, request ${requestId}` : ''}\n`);
      process.stdout.write(`${JSON.stringify(showValues ? json : shape(json), null, 2)}\n\n`);
    } catch (error) {
      failures += 1;
      process.stdout.write(`- ${probe.id} (${probe.capability}): failed, ${error instanceof Error ? error.message : String(error)}\n\n`);
    }
  }
  process.stdout.write(
    failures === 0
      ? 'Every probe answered.\n'
      : `${failures} probe(s) answered with an error. In the sandbox, a 400 "Could not match input arguments" means the call has no canned answer for these parameters.\n`,
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
