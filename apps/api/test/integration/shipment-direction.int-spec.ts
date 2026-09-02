/**
 * Shipment Direction Integration Test (#2373, ADR-060)
 *
 * The D8 regression: an outbound shipment and a return label for one
 * `(orderId, connectionId)` are two legitimate rows, and before this slice the
 * partial-unique `UQ_shipments_branch_one_per_order_conn` could hold only one.
 *
 * This spec asserts the three things ONLY a live database can settle, and
 * deliberately nothing else:
 *
 * 1. the widened index admits the outbound+return pair (the D8 regression);
 * 2. it is not *too wide* — a second row in either direction is still refused,
 *    which is the guard the index existed for in the first place;
 * 3. the column carries no lingering database default, so an insert that fails
 *    to state its direction fails loudly rather than silently acquiring one.
 *
 * It writes through raw SQL rather than the repository because
 * `ShipmentRepositoryPort` is an intra-context contract that `apps/**` may not
 * import (`check-cross-context-imports`, docs/architecture-overview.md
 * § Cross-context dependencies in core). That is the right split anyway: the
 * repository's own predicate SHAPES — that each read carries its direction —
 * are query-construction facts, pinned where they belong in
 * `shipment.repository.spec.ts`. What a unit test cannot prove is how Postgres
 * behaves when two rows meet the index, which is what this file is for.
 *
 * Note what (3) does and does NOT prove: the harness builds its schema with
 * TypeORM `synchronize`, not with migrations (`docs/testing-guide.md`
 * § Testcontainers Lifecycle, step 1), so it pins the ORM ENTITY's declaration.
 * The migration's own shape is covered separately by the mechanical
 * information_schema/pg_indexes diff described in the implementation plan.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const ORDER_ID = 'ol_order_dddddddddddddddddddddddddddddddd';
const CONNECTION_ID = '00000000-0000-0000-0000-0000000023f3';

describe('Shipment direction (#2373)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** A branch-1 row: no `providerShipmentId`, so the partial index covers it. */
  const insertBranchOne = (id: string, direction: 'outbound' | 'return'): Promise<unknown> =>
    harness
      .getDataSource()
      .query(
        `INSERT INTO shipments
           ("id", "orderId", "connectionId", "direction", "shippingMethod", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'kurier', 'draft', now(), now())`,
        [id, ORDER_ID, CONNECTION_ID, direction],
      );

  const countRows = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await harness
      .getDataSource()
      .query(`SELECT COUNT(*)::text AS count FROM shipments WHERE "orderId" = $1`, [ORDER_ID]);
    return Number(rows[0]?.count ?? '0');
  };

  it('should allow an outbound and a return branch-1 shipment to coexist for one (order, connection)', async () => {
    await insertBranchOne('ol_shipment_out1', 'outbound');
    await insertBranchOne('ol_shipment_ret1', 'return');

    expect(await countRows()).toBe(2);
  });

  it('should still refuse a second outbound branch-1 shipment for the same (order, connection)', async () => {
    await insertBranchOne('ol_shipment_out1', 'outbound');

    // The guard the index exists for: widening it must not have loosened it.
    await expect(insertBranchOne('ol_shipment_out2', 'outbound')).rejects.toThrow(
      /UQ_shipments_branch_one_per_order_conn/,
    );
  });

  it('should refuse a second return branch-1 shipment for the same (order, connection)', async () => {
    await insertBranchOne('ol_shipment_ret1', 'return');

    // The new cohort is guarded on its own terms — `direction` is a KEY column,
    // not an arm of the WHERE clause, which would have left returns unguarded.
    await expect(insertBranchOne('ol_shipment_ret2', 'return')).rejects.toThrow(
      /UQ_shipments_branch_one_per_order_conn/,
    );
  });

  it('should refuse an insert that states no direction, because the column carries no default', async () => {
    await expect(
      harness
        .getDataSource()
        .query(
          `INSERT INTO shipments
             ("id", "orderId", "connectionId", "shippingMethod", "status", "createdAt", "updatedAt")
           VALUES ('ol_shipment_nodir', $1, $2, 'kurier', 'draft', now(), now())`,
          [ORDER_ID, CONNECTION_ID],
        ),
    ).rejects.toThrow();
  });

  it('should carry no database default and no nullability on shipments.direction', async () => {
    const rows: Array<{ column_default: string | null; is_nullable: string }> = await harness
      .getDataSource()
      .query(
        `SELECT column_default, is_nullable FROM information_schema.columns
         WHERE table_name = 'shipments' AND column_name = 'direction'`,
      );

    expect(rows).toHaveLength(1);
    // A lingering default would make `direction` unstated-but-present on every
    // future insert — the exact trap the migration's DROP DEFAULT closes.
    expect(rows[0]?.column_default).toBeNull();
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('should key the branch-1 guard on direction rather than filtering by it', async () => {
    const rows: Array<{ indexdef: string }> = await harness
      .getDataSource()
      .query(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'shipments' AND indexname = 'UQ_shipments_branch_one_per_order_conn'`,
      );

    expect(rows).toHaveLength(1);
    const def = rows[0]?.indexdef ?? '';
    // `direction` in the key columns, and the predicate untouched. Moving it
    // into the WHERE would stop the index covering return rows entirely.
    expect(def).toMatch(/\("orderId", "connectionId", direction\)/);
    expect(def).toMatch(/WHERE \("providerShipmentId" IS NULL\)/);
  });
});
