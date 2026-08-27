/**
 * Return Stage Projection Integration Test (#2377, `W2-40`)
 *
 * **This is where "SQL and TS agree" is actually proved.**
 *
 * `scripts/check-return-stage-mirror.mjs` pins that the three sides share a
 * vocabulary and a structure. It deliberately does NOT claim a SQL predicate is
 * semantically its TS arm — the two are different languages over different
 * shapes, and a script asserting equivalence would be claiming something it
 * cannot check. So the semantics are pinned here instead: the SAME
 * `RETURN_STAGE_FIXTURES` table the core unit spec runs through
 * `deriveReturnStage` is inserted as real rows and read back through
 * `countReturnsByStage`, one return per fixture.
 *
 * One table, consumed twice. Two copies of a fixture set is two answers.
 *
 * Also covers the two properties only a booted app can show: the `stage` filter
 * and the stage counts test the SAME `RETURN_STAGE_EXPR` (so a filtered page can
 * never disagree with its own chip), and the counts are scoped with `stage`
 * REMOVED (so the chip for the stage you are not looking at stays truthful).
 *
 * @module apps/api/test/integration
 */
import { RETURN_STAGE_FIXTURES } from '@openlinker/core/returns/testing';
import {
  RETURNS_SERVICE_TOKEN,
  ReturnStageValues,
  deriveReturnStage,
  type IReturnsService,
  type ReturnStage,
} from '@openlinker/core/returns';

import { createTestConnection } from './helpers/test-connection.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Return Stage Projection Integration', () => {
  let harness: IntegrationTestHarness;
  let connectionId: string;

  // The cross-context seam, never `ReturnRepositoryPort` — a repository port is
  // an intra-context contract and `check-cross-context-imports` denies it here.
  const returns = (): IReturnsService =>
    harness.getApp().get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false });

  const query = async <T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await harness.getDataSource().query(sql, params)) as T[];

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    connectionId = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  /**
   * Materialise one fixture as a real return.
   *
   * The counters are per-RETURN sums, so they are laid down as lines that add up
   * to them: one `not_returned` line carrying the written-off units (when the
   * fixture has any), and one ordinary line carrying the rest. That is exactly
   * how the aggregate sees a real return, which is the point — a fixture written
   * straight into a single line would not exercise the `FILTER (WHERE
   * custodyState = 'not_returned')` arms at all.
   */
  const seedFixture = async (fixtureIndex: number): Promise<string> => {
    const fixture = RETURN_STAGE_FIXTURES[fixtureIndex];
    const index = fixtureIndex;
    const { counters } = fixture;
    const id = `ol_return_stage_${String(index).padStart(4, '0')}`;

    await query(
      `INSERT INTO "returns" ("id", "sourceConnectionId", "externalReturnId", "internalOrderId", "origin", "declinedAt")
       VALUES ($1, $2, $3, 'ol_order_stage', 'source_ingested', $4)`,
      [id, connectionId, `RET-STAGE-${index}`, fixture.declined ? new Date() : null]
    );

    let lineIndex = 0;

    if (counters.notReturnedLineCount > 0) {
      // Every written-off line together carries `notReturnedQuantityAdvised`;
      // splitting it evenly keeps both the line COUNT and the quantity sum right,
      // and `not_returned` lines always have `received = 0` (the transition
      // refuses a partially-received line).
      const per = Math.floor(counters.notReturnedQuantityAdvised / counters.notReturnedLineCount);
      const remainder = counters.notReturnedQuantityAdvised - per * counters.notReturnedLineCount;
      for (let i = 0; i < counters.notReturnedLineCount; i += 1) {
        await query(
          `INSERT INTO "return_lines"
             ("returnId", "lineIndex", "reason", "custodyState",
              "quantityAdvised", "quantityReceived", "quantityRestocked", "quantityScrapped")
           VALUES ($1, $2, 'withdrawal', 'not_returned', $3, 0, 0, 0)`,
          [id, lineIndex, per + (i === 0 ? remainder : 0)]
        );
        lineIndex += 1;
      }
    }

    const ordinaryLines = counters.lineCount - counters.notReturnedLineCount;
    if (ordinaryLines > 0) {
      // The remaining lines carry every non-written-off number. Loaded onto the
      // first of them; the aggregate sums, so the distribution is immaterial and
      // an even split would only risk rounding the sums away from the fixture.
      const advised = counters.quantityAdvised - counters.notReturnedQuantityAdvised;
      for (let i = 0; i < ordinaryLines; i += 1) {
        const first = i === 0;
        await query(
          `INSERT INTO "return_lines"
             ("returnId", "lineIndex", "reason", "custodyState",
              "quantityAdvised", "quantityReceived", "quantityRestocked", "quantityScrapped")
           VALUES ($1, $2, 'withdrawal', 'advised', $3, $4, $5, $6)`,
          [
            id,
            lineIndex,
            first ? advised : 0,
            first ? counters.quantityReceived : 0,
            first ? counters.quantityRestocked : 0,
            first ? counters.quantityScrapped : 0,
          ]
        );
        lineIndex += 1;
      }
    }

    return id;
  };

  it('should agree with the TS derivation on every fixture', async () => {
    // The whole point of the slice, as one assertion per fixture row.
    for (let i = 0; i < RETURN_STAGE_FIXTURES.length; i += 1) {
      const fixture = RETURN_STAGE_FIXTURES[i];

      // Sanity: the TS side still says what the table claims. If this drifts the
      // SQL comparison below would be measuring against a moved target.
      expect(
        deriveReturnStage(fixture.counters, {
          declinedAt: fixture.declined ? new Date() : null,
        })
      ).toBe(fixture.expected);

      const id = await seedFixture(i);

      const counts = await returns().countReturnsByStage({});
      const inThisStage = counts.byStage[fixture.expected];

      expect({ fixture: fixture.name, stage: inThisStage }).toEqual({
        fixture: fixture.name,
        stage: 1,
      });

      await query(`DELETE FROM "return_lines" WHERE "returnId" = $1`, [id]);
      await query(`DELETE FROM "returns" WHERE "id" = $1`, [id]);
    }
  });

  it('should report counts that sum to the total', async () => {
    for (let i = 0; i < RETURN_STAGE_FIXTURES.length; i += 1) {
      await seedFixture(i);
    }

    const counts = await returns().countReturnsByStage({});
    const summed = ReturnStageValues.reduce((acc, stage) => acc + counts.byStage[stage], 0);

    // The six stages are exhaustive — `awaiting_parcel` is a declared `TRUE`
    // fallback arm — so every row lands in exactly one bucket.
    expect(summed).toBe(counts.total);
    expect(counts.total).toBe(RETURN_STAGE_FIXTURES.length);
  });

  it('should filter on the SAME expression the counts bucket on', async () => {
    for (let i = 0; i < RETURN_STAGE_FIXTURES.length; i += 1) {
      await seedFixture(i);
    }

    const counts = await returns().countReturnsByStage({});

    for (const stage of ReturnStageValues) {
      const rows = await returns().listReturns({ stage }, 100, 0);

      // A filtered page that disagreed with its own chip is the defect one
      // shared expression exists to prevent.
      expect({ stage, rows: rows.length }).toEqual({ stage, rows: counts.byStage[stage] });
    }
  });

  it('should scope the stage counts with `stage` REMOVED', async () => {
    for (let i = 0; i < RETURN_STAGE_FIXTURES.length; i += 1) {
      await seedFixture(i);
    }

    const unfiltered = await returns().countReturnsByStage({});
    // A caller that forgets to strip `stage` must not make every chip report the
    // count of the stage already selected — `countReturnsByStage` strips it.
    const filtered = await returns().countReturnsByStage({ stage: 'declined' });

    expect(filtered).toEqual(unfiltered);
  });

  it('should populate the counter rollup on the list read', async () => {
    const fixtureIndex = RETURN_STAGE_FIXTURES.findIndex(
      (f) => f.counters.notReturnedLineCount > 0 && f.counters.quantityReceived > 0
    );
    await seedFixture(fixtureIndex);
    const fixture = RETURN_STAGE_FIXTURES[fixtureIndex];

    const [record] = await returns().listReturns({}, 10, 0);

    // `null` would mean "this read did not load counters"; the LIST read always
    // does, which is what lets the browser derive a stage at all.
    expect(record.counters).not.toBeNull();
    expect(record.counters).toEqual(fixture.counters);
  });

  it('should report zeroed counters — not null — for a return with no lines', async () => {
    await query(
      `INSERT INTO "returns" ("id", "sourceConnectionId", "externalReturnId", "internalOrderId", "origin")
       VALUES ('ol_return_stage_bare', $1, 'RET-BARE', 'ol_order_stage', 'source_ingested')`,
      [connectionId]
    );

    const [record] = await returns().listReturns({}, 10, 0);

    // Zeroes are a fact about the RETURN; `null` is a fact about the query.
    expect(record.counters).toEqual({
      lineCount: 0,
      notReturnedLineCount: 0,
      quantityAdvised: 0,
      notReturnedQuantityAdvised: 0,
      quantityReceived: 0,
      quantityRestocked: 0,
      quantityScrapped: 0,
    });
    expect(deriveReturnStage(record.counters!, { declinedAt: null })).toBe<ReturnStage>(
      'awaiting_parcel'
    );
  });
});
