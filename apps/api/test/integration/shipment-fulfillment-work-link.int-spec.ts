/**
 * Shipment → FulfillmentWork linkage (#2402, `W3a-13`)
 *
 * Four things only a live database can settle:
 *
 * 1. **The link is actually PERSISTED on create.** `ShipmentRepository.create`
 *    saves a fully-populated entity built by `buildOrmEntity`, which assigns
 *    every column explicitly — so omitting the new column there would NOT fail
 *    to compile: `save` would simply write NULL on every row, silently. A
 *    service-level unit spec mocking `shipments.create` sees only the call
 *    ARGUMENT and would stay green through exactly that defect. Hence an
 *    integration test, and hence an assertion on the row read back.
 * 2. **`claimFulfillmentWorkLink` fills in when NULL** — the repair path for a
 *    branch-1 row minted by the status poll before its order was routed.
 * 3. **It is monotone**: a second claim reports `false` and does not rewrite,
 *    so a re-dispatch under a different work can never rewrite the provenance
 *    of a parcel that already shipped.
 * 4. **Two OVERLAPPING claims produce exactly one winner.** A *sequential* pair
 *    passes against an implementation with no guard at all (#2399's precedent),
 *    so it would be no evidence — these are issued concurrently against the
 *    same row.
 *
 * The repository is resolved from the booted app by its Symbol token rather
 * than imported: `ShipmentRepositoryPort` is an intra-context contract that
 * `apps/**` may not import (`check-cross-context-imports`), while the token is
 * published on the barrel.
 *
 * @module apps/api/test/integration
 */
import { SHIPMENT_REPOSITORY_TOKEN } from '@openlinker/core/shipping';
import type { Shipment } from '@openlinker/core/shipping';

/**
 * The two methods this spec exercises, declared STRUCTURALLY rather than by
 * importing `ShipmentRepositoryPort`.
 *
 * That import is denied to `apps/**` by `check-cross-context-imports`
 * (`RepositoryPort$`): a repository port is an intra-context contract, and the
 * published cross-context surface is the Symbol token plus the domain entity —
 * both of which this file does import. Naming only what it calls also keeps the
 * spec from breaking when an unrelated method joins the port.
 */
interface ShipmentWriter {
  create(input: {
    orderId: string;
    connectionId: string;
    shippingMethod: 'kurier';
    direction?: 'outbound' | 'return';
    fulfillmentWorkId?: string;
  }): Promise<Shipment>;
  claimFulfillmentWorkLink(id: string, fulfillmentWorkId: string): Promise<boolean>;
}

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const ORDER_ID = 'ol_order_2402240224022402240224022402';
const CONNECTION_ID = '00000000-0000-0000-0000-000000002402';
const WORK_A = 'ol_fulfillmentwork_aaaaaaaaaaaaaaaaaaaaaaaa';
const WORK_B = 'ol_fulfillmentwork_bbbbbbbbbbbbbbbbbbbbbbbb';

describe('Shipment → FulfillmentWork linkage (#2402)', () => {
  let harness: IntegrationTestHarness;
  let shipments: ShipmentWriter;

  beforeAll(async () => {
    harness = await getTestHarness();
    shipments = harness.getApp().get<ShipmentWriter>(SHIPMENT_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const readLink = async (id: string): Promise<string | null> => {
    const rows = (await harness
      .getDataSource()
      .query(`SELECT "fulfillmentWorkId" FROM shipments WHERE "id" = $1`, [id])) as {
      fulfillmentWorkId: string | null;
    }[];
    return rows[0]?.fulfillmentWorkId ?? null;
  };

  it('should PERSIST the work id supplied at create (not merely accept it)', async () => {
    const created = await shipments.create({
      orderId: ORDER_ID,
      connectionId: CONNECTION_ID,
      shippingMethod: 'kurier',
      fulfillmentWorkId: WORK_A,
    });

    // Read straight from the table: the domain object could carry a value the
    // row does not, which is precisely the `buildOrmEntity` omission.
    await expect(readLink(created.id)).resolves.toBe(WORK_A);
  });

  it('should leave the link NULL when create supplies none', async () => {
    const created = await shipments.create({
      orderId: ORDER_ID,
      connectionId: CONNECTION_ID,
      shippingMethod: 'kurier',
    });

    await expect(readLink(created.id)).resolves.toBeNull();
  });

  it('should fill in the link on a row that was created without one', async () => {
    const created = await shipments.create({
      orderId: ORDER_ID,
      connectionId: CONNECTION_ID,
      shippingMethod: 'kurier',
    });

    await expect(shipments.claimFulfillmentWorkLink(created.id, WORK_A)).resolves.toBe(true);
    await expect(readLink(created.id)).resolves.toBe(WORK_A);
  });

  it('should refuse a second claim and leave the original link intact', async () => {
    const created = await shipments.create({
      orderId: ORDER_ID,
      connectionId: CONNECTION_ID,
      shippingMethod: 'kurier',
      fulfillmentWorkId: WORK_A,
    });

    await expect(shipments.claimFulfillmentWorkLink(created.id, WORK_B)).resolves.toBe(false);
    await expect(readLink(created.id)).resolves.toBe(WORK_A);
  });

  it('should admit exactly ONE of two OVERLAPPING claims on the same row', async () => {
    const created = await shipments.create({
      orderId: ORDER_ID,
      connectionId: CONNECTION_ID,
      shippingMethod: 'kurier',
    });

    // Issued concurrently, not sequentially: a sequential pair passes against
    // an implementation with no `IS NULL` guard at all, so it proves nothing.
    const results = await Promise.all([
      shipments.claimFulfillmentWorkLink(created.id, WORK_A),
      shipments.claimFulfillmentWorkLink(created.id, WORK_B),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);

    // And the row holds whichever one won — never a blend, never NULL.
    const persisted = await readLink(created.id);
    expect([WORK_A, WORK_B]).toContain(persisted);
  });

  it('should link an outbound row without touching the return row for the same order', async () => {
    // #2373/ADR-060: a return label IS a shipment and shares this table. The
    // linkage must be per-row, or a bridge would read an arriving return as a
    // dispatch — the cross-body defect Wave 2 caught only at integration.
    const outbound = await shipments.create({
      orderId: ORDER_ID,
      connectionId: CONNECTION_ID,
      shippingMethod: 'kurier',
      direction: 'outbound',
    });
    const ret = await shipments.create({
      orderId: ORDER_ID,
      connectionId: CONNECTION_ID,
      shippingMethod: 'kurier',
      direction: 'return',
    });

    await expect(shipments.claimFulfillmentWorkLink(outbound.id, WORK_A)).resolves.toBe(true);

    await expect(readLink(outbound.id)).resolves.toBe(WORK_A);
    await expect(readLink(ret.id)).resolves.toBeNull();
  });
});
