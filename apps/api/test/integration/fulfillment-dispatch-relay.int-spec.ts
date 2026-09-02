/**
 * Fulfillment dispatch relay — at-most-once under real concurrency (#2401, AC3/AC4)
 *
 * **This must be an int-spec, not a unit spec.** The enforcement is the
 * conditional UPDATE `WHERE "dispatchRelayedAt" IS NULL`; a mock can prove the
 * repository BUILDS that clause, but only a real database can prove that two
 * overlapping transactions cannot both satisfy it. And the test must OVERLAP:
 * a sequential claim-then-claim passes against no guard at all, because the
 * second call reads a column the first already set — the #2392/#2399 lesson.
 *
 * RED-FIRST EVIDENCE: run first with `.andWhere('"dispatchRelayedAt" IS NULL')`
 * removed from `FulfillmentWorkRepository.claimDispatchRelay` — the concurrency
 * case fails with several `relayed` outcomes instead of one, which is the
 * assertion that distinguishes a real claim from an unguarded write. The release
 * case is kept alongside it because it fails in the OPPOSITE direction (a claim
 * that never frees), so neither test alone covers both.
 *
 * The relay itself resolves no adapter here: the seeded order carries no
 * identifier mappings, so `OrderLifecycleRelayService` finds zero participants
 * and reports `{targets: []}`. That is deliberate — the subject under test is
 * the CLAIM, and a zero-target relay is exactly the routine path whose vacuous
 * `[].every(...)` must NOT release the claim.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN,
  type FulfillmentDispatchRelayOutcome,
  type IFulfillmentDispatchRelayService,
} from '@openlinker/core/orders';
import {
  FULFILLMENT_RELAY_GATE_SERVICE_TOKEN,
  type IFulfillmentRelayGateService,
} from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Fulfillment dispatch relay at-most-once (#2401)', () => {
  let harness: IntegrationTestHarness;
  let service: IFulfillmentDispatchRelayService;
  let gate: IFulfillmentRelayGateService;

  const WORK_ID = 'ol_work_relay_hygiene';
  /** The 3PL holding the work — the connection the relay must EXCLUDE as author. */
  const HOLDER_CONNECTION_ID = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    harness = await getTestHarness();
    service = harness
      .getApp()
      .get<IFulfillmentDispatchRelayService>(FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN);
    gate = harness.getApp().get<IFulfillmentRelayGateService>(FULFILLMENT_RELAY_GATE_SERVICE_TOKEN);
  }, 180000);

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    await harness
      .getDataSource()
      .query(
        `INSERT INTO "fulfillment_works"("id","orderId","assignedConnectionId") VALUES ($1,'ol_order_relay_hygiene',$2)`,
        [WORK_ID, HOLDER_CONNECTION_ID]
      );
  });

  const readRelayedAt = async (): Promise<Date | null> => {
    const rows: Array<{ dispatchRelayedAt: Date | null }> = await harness
      .getDataSource()
      .query(`SELECT "dispatchRelayedAt" FROM "fulfillment_works" WHERE "id" = $1`, [WORK_ID]);
    return rows[0]?.dispatchRelayedAt ?? null;
  };

  it('relays exactly once when several progress events land concurrently', async () => {
    const outcomes: FulfillmentDispatchRelayOutcome[] = await Promise.all(
      Array.from({ length: 8 }, () => service.relayDispatch({ kind: 'dispatch', workId: WORK_ID }))
    );

    expect(outcomes.filter((o) => o.status === 'relayed')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'already-relayed')).toHaveLength(7);
    expect(await readRelayedAt()).not.toBeNull();
  });

  it('a released claim can be re-driven by a later event', async () => {
    const first = await gate.claimDispatch(WORK_ID);
    expect(first.status).toBe('claimed');

    // A peer cannot claim while it is held.
    expect((await gate.claimDispatch(WORK_ID)).status).toBe('already-relayed');

    await gate.releaseDispatch(WORK_ID);
    expect(await readRelayedAt()).toBeNull();

    // ...and the slot is genuinely free again.
    expect((await gate.claimDispatch(WORK_ID)).status).toBe('claimed');
  });

  it('reports unknown-work without touching any row', async () => {
    const outcome = await service.relayDispatch({ kind: 'dispatch', workId: 'ol_work_absent' });
    expect(outcome).toEqual({ status: 'unknown-work', workId: 'ol_work_absent' });
    expect(await readRelayedAt()).toBeNull();
  });
});
