/**
 * InPost ShipX sandbox API probe
 *
 * Throwaway exploration script — fires a few read-only requests against the
 * InPost ShipX sandbox to confirm the temp token works and to see the live
 * response shapes. Not wired into the build; run it directly with Node 18+.
 *
 *   INPOST_TOKEN="<jwt>" node scripts/inpost-sandbox-probe.mjs
 *
 * Optional env:
 *   INPOST_ORG_ID  — organization id to probe org-scoped endpoints
 */

const BASE = process.env.INPOST_BASE ?? 'https://sandbox-api-shipx-pl.easypack24.net/v1';
const TOKEN = process.env.INPOST_TOKEN;

if (!TOKEN) {
  console.error('Missing INPOST_TOKEN env var.');
  process.exit(1);
}

function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function call(method, path, { query, body } = {}) {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  console.log(`\n──> ${method} ${url.pathname}${url.search}`);
  const start = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.log(`    ✖ network error: ${err.message}`);
    return null;
  }

  const ms = Date.now() - start;
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  console.log(`    <── ${res.status} ${res.statusText} (${ms}ms)`);
  const preview = JSON.stringify(json, null, 2);
  console.log(
    preview && preview.length > 1500 ? preview.slice(0, 1500) + '\n    …[truncated]' : preview,
  );
  return { status: res.status, json };
}

async function main() {
  console.log('=== InPost ShipX sandbox probe ===');
  console.log(`base: ${BASE}`);

  const claims = decodeJwt(TOKEN);
  if (claims) {
    console.log('\n--- token claims ---');
    console.log(`  iss:    ${claims.iss}`);
    console.log(`  azp:    ${claims.azp}`);
    console.log(`  scope:  ${claims.scope}`);
    console.log(`  email:  ${claims.email}`);
    console.log(`  exp:    ${new Date(claims.exp * 1000).toISOString()}`);
  }

  // 1. apipoints scope — public-ish points listing, no org required.
  await call('GET', '/points', { query: { per_page: 1 } });

  // 2. organizations the token can act on (gives us the org id for shipx).
  const orgs = await call('GET', '/organizations');
  const orgId =
    process.env.INPOST_ORG_ID ?? orgs?.json?.items?.[0]?.id ?? orgs?.json?.id ?? null;
  console.log(`\n  resolved org id: ${orgId ?? '(none)'}`);

  // 3. org-scoped reads, only if we have an org id.
  if (orgId) {
    await call('GET', `/organizations/${orgId}/shipments`, { query: { per_page: 1 } });
    await call('GET', `/organizations/${orgId}/services`);
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
