/**
 * Waybill-Relay Failure Tracking — Schema Integration Test (#2073)
 *
 * The five failure columns, their CHECK and their partial index are declared
 * TWICE — on `ShipmentOrmEntity` and in migration `1876000000000` — under
 * identical names. This spec is what makes that duplication verifiable rather
 * than merely intended: the harness builds schema by TypeORM `synchronize` and
 * never runs migrations, so a constraint present only in the migration would
 * hold in production and silently not in any test.
 *
 * It asserts the **entity** side, which is the half `synchronize` can answer
 * for. Whole-table migration-versus-`synchronize` parity for `shipments` is a
 * separate, larger question — `fulfillment-work-migration-parity.int-spec.ts`
 * has an extensible `TABLES` list and `shipments` is deliberately not in it
 * yet: that table predates most of this repo's migration discipline, so adding
 * it may surface pre-existing drift unrelated to this change and is worth its
 * own issue rather than being smuggled in here.
 *
 * Raw SQL against the harness DataSource, deliberately: `apps/**` may not
 * import a core `*RepositoryPort` (`scripts/check-cross-context-imports.mjs`),
 * and a catalogue read is what these assertions are actually about.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';

describe('shipments waybill-relay failure columns (#2073)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<unknown>;

  beforeAll(async () => {
    const harness = await getTestHarness();
    const dataSource = harness.getDataSource();
    query = (sql, params) => dataSource.query(sql, params);
  }, 120_000);

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
  });

  it('should declare all five columns with the table-consistent timestamp type', async () => {
    const rows = (await query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shipments'
          AND column_name LIKE 'waybillRelay%'
        ORDER BY column_name`,
    )) as ReadonlyArray<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>;

    const byName = new Map(rows.map((r) => [r.column_name, r]));

    // The pre-existing claim marker, included so the timestamp-type assertions
    // below are anchored to something this change did not author.
    expect(byName.get('waybillRelayedAt')?.data_type).toBe('timestamp without time zone');

    // `integer NOT NULL DEFAULT 0`. The DEFAULT is load-bearing on a
    // `synchronize`-built schema, which takes it from the DECORATOR rather
    // than from the migration (docs/lessons.md, out-of-band-UPDATE entry).
    expect(byName.get('waybillRelayFailureCount')?.data_type).toBe('integer');
    expect(byName.get('waybillRelayFailureCount')?.is_nullable).toBe('NO');
    expect(byName.get('waybillRelayFailureCount')?.column_default).toBe('0');

    // Plain `timestamp`, matching every other timestamp on this table — NOT
    // the `timestamptz` the webhook_auth_rejections counter (#1814) uses.
    expect(byName.get('waybillRelayFirstFailedAt')?.data_type).toBe(
      'timestamp without time zone',
    );
    expect(byName.get('waybillRelayLastFailedAt')?.data_type).toBe('timestamp without time zone');
    expect(byName.get('waybillRelayFirstFailedAt')?.is_nullable).toBe('YES');
    expect(byName.get('waybillRelayLastFailedAt')?.is_nullable).toBe('YES');

    expect(byName.get('waybillRelayLastFailureReason')?.data_type).toBe('text');
    expect(byName.get('waybillRelayLastFailureConnectionId')?.data_type).toBe('uuid');
  });

  it('should carry the named CHECK constraint on the synchronize-built schema', async () => {
    const rows = (await query(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conname = 'CHK_shipments_waybill_relay_failure_count'`,
    )) as ReadonlyArray<{ def: string }>;

    expect(rows).toHaveLength(1);
    // Copied from a REAL rendered value, not from the DDL as typed:
    // `pg_get_constraintdef` quotes a camelCase identifier and would render an
    // all-lowercase one unquoted (docs/lessons.md, schema-assertion entry).
    expect(rows[0].def).toContain('"waybillRelayFailureCount" >= 0');
  });

  it('should refuse a negative failure count', async () => {
    // The constraint documents that the column is a counter and catches a
    // future writer that decrements. Nothing in this codebase can reach it
    // today, which is exactly why it is asserted directly.
    await expect(
      query(
        `INSERT INTO "shipments"
           ("id", "orderId", "connectionId", "direction", "shippingMethod",
            "status", "waybillRelayFailureCount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'outbound', 'kurier', 'draft', -1, now(), now())`,
        [
          'ol_shipment_ffffffffffffffffffffffffffffffff',
          'ol_order_ffffffffffffffffffffffffffffffff',
          '00000000-0000-0000-0000-0000000000ff',
        ],
      ),
    ).rejects.toThrow(/CHK_shipments_waybill_relay_failure_count/);
  });

  it('should carry the partial index restricted to rows with a failure', async () => {
    const rows = (await query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'shipments'
          AND indexname = 'IDX_shipments_waybill_relay_failing'`,
    )) as ReadonlyArray<{ indexdef: string }>;

    expect(rows).toHaveLength(1);
    // PARTIAL is the point: every row is born outside this index (the count
    // defaults to 0), so it stays near-empty and shrinks as relays succeed.
    expect(rows[0].indexdef).toContain('WHERE');
    expect(rows[0].indexdef).toContain('"waybillRelayFailureCount" > 0');
    expect(rows[0].indexdef).toContain('waybillRelayLastFailedAt');
  });
});
