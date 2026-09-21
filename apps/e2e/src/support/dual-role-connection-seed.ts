/**
 * Dual-role connection seed (#3195)
 *
 * `documentKind: 'both'` (#3195) is reachable only for a connection that
 * carries BOTH `Invoicing` and `Fiscalization` enabled at once — no seed in
 * this package produces one (`sales-document-market-seed.ts` and
 * `sales-document-seed.ts` each mint a single-capability KSeF/eparagony
 * connection). This module writes ONE fixed connection row directly into
 * Postgres with both capabilities enabled, the same deliberate exception to
 * this package's HTTP-only rule those two seeds already document: setting a
 * connection's own `enabledCapabilities` has no write path through the OL
 * REST API at all (it is stamped at connection creation, `docs/architecture-
 * overview.md` #2085), so there is nothing to call.
 *
 * `platformType: 'eparagony'` because that IS the real shipped adapter that
 * carries both capabilities on one connection (#3192, `@openlinker/
 * integrations-eparagony`) — this is not a synthetic capability combination,
 * only a synthetic credential.
 *
 * `config.salesDocument.documentKind` starts UNSET (`{}`), because the point
 * of `dual-role-connection.spec.ts` is to drive the real "Issues" select
 * through the UI and prove the write persists — seeding the end state would
 * skip the one thing that spec exists to exercise.
 *
 * Idempotent: a fixed id, `ON CONFLICT (id) DO UPDATE` resets it to the same
 * starting shape on every run (so a spec that changed `documentKind` and
 * failed before cleanup does not leave a stale 'both' row for the next run).
 *
 * @module support
 */
import { Client } from 'pg';
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';

export const DUAL_ROLE_CONNECTION_ID = '44444444-4444-4444-a444-444444444401';
export const DUAL_ROLE_CONNECTION_NAME = 'Dual-role e-paragony (Gap 2 seed)';

export async function seedDualRoleConnection(): Promise<void> {
  assertSeedableDatabase('seedDualRoleConnection');
  const env = resolveEnv();
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO connections
         (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities", "adapterKey")
       VALUES
         ($1, 'eparagony', $2, 'active', '{}'::jsonb, 'seed-eparagony-dualrole', '["Invoicing","Fiscalization"]'::jsonb, 'eparagony.documents.v3')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         status = 'active',
         config = '{}'::jsonb,
         "enabledCapabilities" = EXCLUDED."enabledCapabilities",
         "adapterKey" = EXCLUDED."adapterKey"`,
      [DUAL_ROLE_CONNECTION_ID, DUAL_ROLE_CONNECTION_NAME],
    );
  } finally {
    await client.end();
  }
}
