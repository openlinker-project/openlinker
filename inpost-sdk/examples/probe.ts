/**
 * Read-only probe — exercises the SDK against points + organizations + shipments.
 *
 *   INPOST_TOKEN="<jwt>" node --experimental-strip-types examples/probe.ts
 *
 * Env: INPOST_TOKEN (required), INPOST_BASE (optional), INPOST_ORG_ID (optional).
 */

import { createInpostShipXClient, INPOST_SHIPX_SANDBOX_BASE_URL } from '../src/index.ts';

const token = process.env.INPOST_TOKEN;
if (!token) {
  console.error('Missing INPOST_TOKEN env var.');
  process.exit(1);
}

const client = createInpostShipXClient({
  token,
  baseUrl: process.env.INPOST_BASE ?? INPOST_SHIPX_SANDBOX_BASE_URL,
  organizationId: process.env.INPOST_ORG_ID,
  logLevel: 'debug',
});

function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log('=== InPost ShipX SDK probe ===');

  const claims = decodeJwtClaims(token);
  if (claims) {
    console.log('token:', {
      iss: claims.iss,
      scope: claims.scope,
      email: claims.email,
      exp: typeof claims.exp === 'number' ? new Date(claims.exp * 1000).toISOString() : claims.exp,
    });
  }

  const points = await client.getPoints({ per_page: 1, type: 'parcel_locker' });
  console.log(`points: count=${points.count}, first=${points.items[0]?.name}`);

  const orgs = await client.listOrganizations();
  const org = orgs.items[0];
  console.log(`organizations: count=${orgs.count}`, org && { id: org.id, name: org.name, services: org.services });

  if (org) {
    const shipments = await client.listShipments({ per_page: 3 }, org.id);
    console.log(`shipments: count=${shipments.count}`);
    for (const s of shipments.items) {
      console.log(`  #${s.id} status=${s.status} tracking=${s.tracking_number ?? '—'}`);
    }
  }
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});
