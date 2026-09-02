/**
 * Return Stage Derivation — table-driven spec (#2377)
 *
 * Runs the shared fixture table (`return-stage.fixtures.ts`) through
 * `deriveReturnStage`. The integration spec runs the SAME table through the SQL
 * twin, which is how "SQL and TS agree" is actually proved — the mirror script
 * pins vocabulary and structure, never meaning.
 *
 * @module libs/core/src/returns/domain/types/__tests__
 */
import { RETURN_STAGE_FIXTURES } from '../../../testing/return-stage.fixtures';
import {
  ReturnStageValues,
  deriveReturnStage,
  expectedQuantity,
  isReturnStage,
  undisposedQuantity,
} from '../return-stage.types';

describe('deriveReturnStage (#2377)', () => {
  it.each(RETURN_STAGE_FIXTURES.map((f) => [f.name, f] as const))(
    'should derive %s',
    (_name, fixture) => {
      const stage = deriveReturnStage(fixture.counters, {
        declinedAt: fixture.declined ? new Date('2026-08-01T00:00:00.000Z') : null,
      });

      expect(stage).toBe(fixture.expected);
    }
  );

  it('should cover every stage in the vocabulary', () => {
    // #2377's assumption: six stages cover every counter combination, and a
    // combination with no stage is a test failure rather than a fallback. This
    // asserts the converse — no stage is declared and never demonstrated.
    const covered = new Set(RETURN_STAGE_FIXTURES.map((f) => f.expected));

    expect([...covered].sort()).toEqual([...ReturnStageValues].sort());
  });

  it('should always answer a value from the vocabulary', () => {
    for (const fixture of RETURN_STAGE_FIXTURES) {
      const stage = deriveReturnStage(fixture.counters, { declinedAt: null });
      expect(isReturnStage(stage)).toBe(true);
    }
  });

  it('should never mutate its inputs', () => {
    const [fixture] = RETURN_STAGE_FIXTURES;
    const before = JSON.stringify(fixture.counters);

    deriveReturnStage(fixture.counters, { declinedAt: null });

    expect(JSON.stringify(fixture.counters)).toBe(before);
  });
});

describe('expectedQuantity (#2377)', () => {
  it('should subtract units written off as never arriving', () => {
    // `advised` in the stage arms means STILL EXPECTED, not originally announced.
    expect(
      expectedQuantity({
        lineCount: 2,
        notReturnedLineCount: 1,
        quantityAdvised: 5,
        notReturnedQuantityAdvised: 2,
        quantityReceived: 3,
        quantityRestocked: 0,
        quantityScrapped: 0,
      })
    ).toBe(3);
  });

  it('should equal the advised total when nothing was written off', () => {
    expect(
      expectedQuantity({
        lineCount: 1,
        notReturnedLineCount: 0,
        quantityAdvised: 5,
        notReturnedQuantityAdvised: 0,
        quantityReceived: 0,
        quantityRestocked: 0,
        quantityScrapped: 0,
      })
    ).toBe(5);
  });
});

describe('undisposedQuantity (#2377)', () => {
  it('should count received units that were neither restocked nor scrapped', () => {
    expect(
      undisposedQuantity({
        lineCount: 1,
        notReturnedLineCount: 0,
        quantityAdvised: 5,
        notReturnedQuantityAdvised: 0,
        quantityReceived: 5,
        quantityRestocked: 2,
        quantityScrapped: 1,
      })
    ).toBe(2);
  });
});

describe('isReturnStage (#2377)', () => {
  it.each(ReturnStageValues)('should accept %s', (value) => {
    expect(isReturnStage(value)).toBe(true);
  });

  it.each([['unknown'], [''], [null], [undefined], [7]])(
    'should reject %p without defaulting it to another stage',
    (value) => {
      expect(isReturnStage(value)).toBe(false);
    }
  );
});
