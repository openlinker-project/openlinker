/**
 * Global harness isolation - regression guard (#2999)
 *
 * `setup-each.ts` registers a `beforeEach` + `afterEach` reset for every
 * int-spec through `setupFilesAfterEnv`. That registration is one line in
 * `apps/worker/test/jest-integration.cjs`: delete it and nothing fails,
 * nothing warns, and the suite goes back to a state where a file's first
 * assertion can read whatever the previous file left behind (and six specs
 * reset nothing between their own test cases at all). That is the shape of
 * defect the fix exists to remove, so it needs an assertion that goes red
 * when the wiring goes away.
 *
 * ## How it works
 *
 * This file deliberately registers NO reset of its own - that absence is the
 * test. The first case leaves a connection row behind on purpose; the second
 * asserts it is gone. Only the global hook can have removed it.
 *
 * ## What it proves, and what it does not
 *
 * Proves: the harness really is reset BETWEEN the test cases of a spec that
 * resets nothing itself, i.e. `setup-each.ts` is registered and running - AND
 * that the `beforeEach` half specifically is (#3126 review). The second is a
 * separate claim and needs its own case: an earlier revision of this file
 * could not tell the two hooks apart, so deleting ONLY the `beforeEach` line
 * left it green while removing the half `setup-each.ts` itself calls "the
 * load-bearing one". That is the plausible edit, precisely because
 * `afterEach` looks sufficient.
 *
 * The distinguishing case writes a row in `beforeAll` and asserts it is gone
 * in the FIRST `it()`. No `afterEach` can have removed it - nothing has
 * finished yet when that assertion runs - so only the root `beforeEach` can
 * have. Hook order is what makes it sound: Jest runs `beforeAll`, then every
 * `beforeEach` outermost-first (the `setupFilesAfterEnv` one is outermost),
 * then the test body.
 *
 * Does not prove: that the previous FILE's rows were cleared - that would
 * need a fixture spanning two files, which Jest's default ordering on this
 * config does not guarantee, and an order-dependent guard against an
 * order-dependence bug is not a guard.
 *
 * Counts are taken RELATIVE to a baseline rather than against a literal zero.
 * A literal zero would additionally assert that booting `AppModule` seeds no
 * connection row - true today, but a claim this file has no business making.
 *
 * @module apps/worker/test/integration
 * @see setup-each.ts - the registration this file guards.
 */
import { DataSource } from 'typeorm';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

import { getTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

async function countConnections(dataSource: DataSource): Promise<number> {
  return dataSource.getRepository(ConnectionOrmEntity).count();
}

describe('Global integration-harness isolation (#2999)', () => {
  let harness: WorkerIntegrationTestHarness;
  let baseline = -1;
  let countAfterBeforeAllWrite = -1;

  beforeAll(async () => {
    harness = await getTestHarness();

    // Written BEFORE any test case runs, so only the root `beforeEach` can
    // clear it. See the docblock - this is the half that was unguarded.
    const dataSource = harness.getDataSource();
    await createTestConnection(dataSource, { name: 'harness-isolation beforeAll probe' });
    countAfterBeforeAllWrite = await countConnections(dataSource);
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  // NO beforeEach/afterEach reset here, on purpose. See the docblock.

  it('should not see the row written in beforeAll — only the root beforeEach can have cleared it (#3126 review)', async () => {
    // Non-vacuity: if `beforeAll` never actually wrote, "the row is gone" is
    // trivially true and this case would pass with both hooks deleted.
    expect(countAfterBeforeAllWrite).toBeGreaterThan(0);

    // Strictly fewer than the post-write count. Deliberately not `toBe(0)`:
    // that would additionally assert AppModule seeds no connection row, a
    // claim this file has no business making (see the docblock).
    expect(await countConnections(harness.getDataSource())).toBeLessThan(
      countAfterBeforeAllWrite
    );
  });

  it('should record a row that this file never cleans up', async () => {
    const dataSource = harness.getDataSource();

    baseline = await countConnections(dataSource);
    await createTestConnection(dataSource, { name: 'harness-isolation probe' });

    // Non-vacuity for the next case: without this, "the row is gone" would be
    // trivially true for a row that was never written.
    expect(await countConnections(dataSource)).toBe(baseline + 1);
  });

  it('should not see the row the previous case left, because the harness was reset', async () => {
    // Guard against a reordering that would make this case run first and pass
    // for the wrong reason - an unset baseline is not a clean database.
    expect(baseline).toBeGreaterThanOrEqual(0);

    expect(await countConnections(harness.getDataSource())).toBe(baseline);
  });
});
