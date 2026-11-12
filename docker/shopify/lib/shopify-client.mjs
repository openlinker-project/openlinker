/**
 * Shopify Admin GraphQL client for the dev-store tooling (#3928, #3983)
 *
 * Dependency-free (Node >= 22 global fetch) so the tooling container needs no
 * `npm install`. Handles the two throttle signals a dev store actually emits:
 * the cost-based `THROTTLED` GraphQL error, and the dev-store order-creation cap,
 * which arrives as a plain `userErrors` entry ("Too many attempts") rather than an
 * HTTP 429 (SPIKE-2879, Recommendation item 5).
 *
 * Auth: a pre-issued Admin API access token (`SHOPIFY_ACCESS_TOKEN`), or the
 * client-credentials grant from the app's client id/secret. The grant works for
 * a dev store in the same organization as the app (spike #3928, K01); a store in
 * another organization answers `shop_not_permitted` and needs the OAuth install.
 *
 * Deliberately separate from `libs/integrations/shopify`: this runs in a bare
 * `node` container with no build and no `node_modules`.
 */

const DEFAULT_API_VERSION = '2026-10';
const MAX_RETRIES = 6;

export function readConfig(env = process.env) {
  const domain = (env.SHOPIFY_STORE_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain) {
    throw new Error('SHOPIFY_STORE_DOMAIN is not set (e.g. ol-dev-yourname.myshopify.com)');
  }
  const accessToken = (env.SHOPIFY_ACCESS_TOKEN ?? '').trim();
  const clientId = (env.SHOPIFY_CLIENT_ID ?? '').trim();
  const clientSecret = (env.SHOPIFY_CLIENT_SECRET ?? '').trim();
  if (!accessToken && !(clientId && clientSecret)) {
    throw new Error('Set SHOPIFY_ACCESS_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET');
  }
  return {
    domain,
    apiVersion: (env.SHOPIFY_API_VERSION ?? '').trim() || DEFAULT_API_VERSION,
    accessToken,
    clientId,
    clientSecret,
  };
}

async function exchangeClientCredentials({ domain, clientId, clientSecret }) {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`client_credentials grant failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const body = JSON.parse(text);
  if (!body.access_token) {
    throw new Error(`client_credentials grant returned no access_token: ${text.slice(0, 300)}`);
  }
  return body.access_token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTooManyAttempts(userErrors) {
  return (userErrors ?? []).some((e) => /too many attempts/i.test(e.message ?? ''));
}

export async function createClient(config = readConfig()) {
  const token = config.accessToken || (await exchangeClientCredentials(config));
  const endpoint = `https://${config.domain}/admin/api/${config.apiVersion}/graphql.json`;

  /**
   * Runs one GraphQL operation. Retries on cost throttling and on the dev-store
   * order cap. `userErrorsPath` names the payload field whose `userErrors` the
   * caller cares about, so the order cap can be detected; callers still inspect
   * `userErrors` themselves for every other failure.
   */
  async function request(query, variables = {}, { userErrorsPath } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
        body: JSON.stringify({ query, variables }),
      });
      const text = await res.text();
      if (res.status === 429 && attempt < MAX_RETRIES) {
        await sleep(Number(res.headers.get('retry-after') ?? 2) * 1000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${endpoint}: ${text.slice(0, 500)}`);
      }
      const body = JSON.parse(text);
      const throttled = (body.errors ?? []).some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < MAX_RETRIES) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (body.errors?.length) {
        throw new Error(`GraphQL errors: ${JSON.stringify(body.errors, null, 2)}`);
      }
      const userErrors = userErrorsPath ? body.data?.[userErrorsPath]?.userErrors : undefined;
      if (isTooManyAttempts(userErrors) && attempt < MAX_RETRIES) {
        // The dev-store orderCreate cap is ~5/min; a full window is the honest wait.
        process.stdout.write(`  order-creation cap hit, waiting 65s (attempt ${attempt + 1})\n`);
        await sleep(65_000);
        continue;
      }
      return body;
    }
  }

  return { request, endpoint, apiVersion: config.apiVersion };
}

/** Throws with a readable message when a mutation payload carries userErrors. */
export function assertNoUserErrors(payload, label) {
  const errors = payload?.userErrors ?? payload?.orderCancelUserErrors ?? [];
  if (errors.length) {
    throw new Error(`${label} failed: ${JSON.stringify(errors)}`);
  }
}
