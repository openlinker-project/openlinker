/**
 * Child-process helper for the invoice_records timestamptz regression test
 * (#1296). Runs as a SEPARATE Node process (spawned with an explicit `TZ` env
 * var) so it gets a genuinely different OS-level process timezone than the
 * Jest parent — `process.env.TZ` reassignment at runtime does not reliably
 * change already-initialized Date/Intl timezone state within a single
 * process, so a real skew reproduction needs a real process boundary.
 *
 * Usage: TZ=<zone> PGHOST=<host> PGPORT=<port> PGUSER=<user> PGPASSWORD=<password> PGDATABASE=<database> \
 *   node tz-claim-probe.child.cjs <mode> <id> <leaseIso> <nowIso>
 *   mode = 'write'   — sets invoice_records.leaseExpiresAt = leaseIso for id.
 *   mode = 'compare' — runs the exact claimForIssue CAS predicate with
 *                      leaseExpiresAt = leaseIso (new lease) and :now = nowIso,
 *                      prints {"claimed": true|false} as JSON to stdout.
 *
 * Connection details travel via the standard `PG*` environment variables
 * (not argv) so the test-container password never appears in `ps` output.
 */
const { Client } = require('pg');

async function main() {
  const [, , mode, id, leaseIso, nowIso] = process.argv;
  // `Client` with no config reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
  const client = new Client();
  await client.connect();

  try {
    if (mode === 'write') {
      await client.query('UPDATE invoice_records SET "leaseExpiresAt" = $1 WHERE id = $2', [
        new Date(leaseIso),
        id,
      ]);
      process.stdout.write(JSON.stringify({ ok: true }));
      return;
    }

    if (mode === 'compare') {
      const result = await client.query(
        `UPDATE invoice_records
           SET status = 'issuing', "leaseExpiresAt" = $1
           WHERE id = $2
             AND (status = 'pending'
               OR (status = 'failed' AND "failureMode" = 'rejected')
               OR (status = 'issuing' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= $3)))`,
        [new Date(leaseIso), id, new Date(nowIso)],
      );
      process.stdout.write(JSON.stringify({ claimed: (result.rowCount ?? 0) > 0 }));
      return;
    }

    throw new Error(`Unknown mode: ${mode}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
