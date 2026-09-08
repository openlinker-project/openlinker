/**
 * Global harness isolation - regression guard (#2986)
 *
 * `setup-each.ts` registers a `beforeEach` + `afterEach` reset for every
 * int-spec through `setupFilesAfterEnv`. That registration is one line in
 * `apps/api/test/jest-integration.cjs`: delete it and nothing fails, nothing
 * warns, and the suite goes back to 118 specs whose first assertion reads
 * whatever the previous file left behind. That is the shape of defect the fix
 * exists to remove, so it needs an assertion that goes red when the wiring
 * goes away.
 *
 * ## How it works
 *
 * This file deliberately registers NO reset of its own - that absence is the
 * test. The first case leaves a row behind on purpose; the second asserts it
 * is gone. Only the global hook can have removed it.
 *
 * ## What it proves, and what it does not
 *
 * Proves: the harness really is reset BETWEEN the test cases of a spec that
 * resets nothing itself, i.e. `setup-each.ts` is registered and running.
 *
 * Does not prove: which of the two hooks did it (indistinguishable from
 * inside one file), nor that the previous FILE's rows were cleared - that
 * would need a fixture spanning two files, which Jest's default ordering on
 * this config does not guarantee, and an order-dependent guard against an
 * order-dependence bug is not a guard.
 *
 * Counts are taken RELATIVE to a baseline rather than against a literal zero.
 * A literal zero would additionally assert that booting `AppModule` seeds no
 * connection row - true today, but a claim this file has no business making,
 * and one that would turn an unrelated change into a mystifying failure here.
 * `oms-connection-never-seeded.int-spec.ts` owns the never-seeded question.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, IntegrationTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { countConnections } from './helpers/test-database.helper';

describe('Global integration-harness isolation (#2986)', () => {
  let harness: IntegrationTestHarness;
  let baseline = -1;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  // NO beforeEach/afterEach reset here, on purpose. See the docblock.

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
