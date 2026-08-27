/**
 * Return Row — derived stage, table-driven (#2377)
 *
 * The browser half of a rule implemented twice. The table below is the FE mirror
 * of `RETURN_STAGE_FIXTURES`; core runs the same combinations through
 * `deriveReturnStage` and the integration spec runs them through the SQL twin.
 *
 * @module apps/web/src/features/returns/lib
 */
import { describe, expect, it } from 'vitest';
import type { ReturnCounters, ReturnListItem } from '../api/returns.types';
import {
  RETURN_STAGE_LABELS,
  RETURN_STAGE_TONES,
  RETURN_STAGE_VALUES,
  deriveReturnStage,
  expectedQuantity,
  returnCounterLine,
  undisposedQuantity,
} from './return-row';
import type { ReturnStage } from './return-stage.types';

function counters(overrides: Partial<ReturnCounters> = {}): ReturnCounters {
  return {
    lineCount: 1,
    notReturnedLineCount: 0,
    quantityAdvised: 5,
    notReturnedQuantityAdvised: 0,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
    ...overrides,
  };
}

function item(c: Partial<ReturnCounters>, declined = false): ReturnListItem {
  return {
    id: 'ol_return_1',
    sourceConnectionId: 'conn-1',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_1',
    externalOrderId: 'EXT-1',
    origin: 'source_ingested',
    bucket: 'attributed',
    rawStatus: null,
    openedAt: null,
    authorizedAt: null,
    declinedAt: declined ? '2026-08-01T00:00:00.000Z' : null,
    closedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    counters: counters(c),
  };
}

const CASES: ReadonlyArray<[string, ReturnListItem, ReturnStage]> = [
  ['nothing arrived', item({}), 'awaiting_parcel'],
  ['a return with no lines', item({ lineCount: 0, quantityAdvised: 0 }), 'awaiting_parcel'],
  ['some arrived, more expected', item({ quantityReceived: 2 }), 'partially_received'],
  [
    'partly arrived AND fully disposed is still not finished',
    item({ quantityReceived: 2, quantityRestocked: 2 }),
    'partially_received',
  ],
  ['all arrived, nothing disposed', item({ quantityReceived: 5 }), 'received_awaiting_disposition'],
  [
    'all arrived, some disposed',
    item({ quantityReceived: 5, quantityScrapped: 3 }),
    'received_awaiting_disposition',
  ],
  ['all arrived and all restocked', item({ quantityReceived: 5, quantityRestocked: 5 }), 'disposed'],
  [
    'all arrived, split between restock and scrap',
    item({ quantityReceived: 5, quantityRestocked: 3, quantityScrapped: 2 }),
    'disposed',
  ],
  [
    'THE SUBTRACTION: one line disposed, one written off — finished',
    item({
      lineCount: 2,
      notReturnedLineCount: 1,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 2,
      quantityReceived: 3,
      quantityRestocked: 3,
    }),
    'disposed',
  ],
  [
    'a written-off line does not hide units still awaiting disposition',
    item({
      lineCount: 2,
      notReturnedLineCount: 1,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 2,
      quantityReceived: 3,
    }),
    'received_awaiting_disposition',
  ],
  [
    'a written-off line leaves a genuinely partial receipt partial',
    item({
      lineCount: 3,
      notReturnedLineCount: 1,
      quantityAdvised: 9,
      notReturnedQuantityAdvised: 2,
      quantityReceived: 4,
    }),
    'partially_received',
  ],
  [
    'every line written off',
    item({
      lineCount: 2,
      notReturnedLineCount: 2,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 5,
    }),
    'not_returned',
  ],
  [
    'SOME lines written off is not `not_returned`',
    item({
      lineCount: 2,
      notReturnedLineCount: 1,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 2,
      quantityReceived: 1,
    }),
    'partially_received',
  ],
  ['the source declined it', item({}, true), 'declined'],
  [
    'declined outranks a completed disposition',
    item({ quantityReceived: 5, quantityRestocked: 5 }, true),
    'declined',
  ],
];

describe('deriveReturnStage (#2377)', () => {
  it.each(CASES)('should derive %s', (_name, listItem, expected) => {
    expect(deriveReturnStage(listItem)).toBe(expected);
  });

  it('should demonstrate every stage in the vocabulary', () => {
    const covered = new Set(CASES.map(([, , stage]) => stage));
    expect([...covered].sort()).toEqual([...RETURN_STAGE_VALUES].sort());
  });
});

describe('stage presentation (#2377)', () => {
  it('should label every stage', () => {
    for (const stage of RETURN_STAGE_VALUES) {
      expect(RETURN_STAGE_LABELS[stage].length).toBeGreaterThan(0);
    }
  });

  it('should tone only `declined`', () => {
    // Every other stage is a routine position in a return's life; colouring them
    // would put warning tones over a healthy install's whole list.
    const toned = RETURN_STAGE_VALUES.filter((s) => RETURN_STAGE_TONES[s] !== 'neutral');
    expect(toned).toEqual(['declined']);
  });

  it('should use the spec labels verbatim', () => {
    expect(RETURN_STAGE_LABELS.received_awaiting_disposition).toBe('Received — awaiting disposition');
    expect(RETURN_STAGE_LABELS.awaiting_parcel).toBe('Awaiting parcel');
  });
});

describe('returnCounterLine (#2377)', () => {
  it('should read `n of m received` against units STILL EXPECTED', () => {
    // Not `quantityAdvised`: counting against a total that includes written-off
    // units would show `3 of 5` where only three were ever coming.
    expect(
      returnCounterLine(
        counters({ quantityAdvised: 5, notReturnedQuantityAdvised: 2, quantityReceived: 3 })
      )
    ).toBe('3 of 3 received');
  });

  it('should read against the advised total when nothing was written off', () => {
    expect(returnCounterLine(counters({ quantityReceived: 2 }))).toBe('2 of 5 received');
  });
});

describe('counter helpers (#2377)', () => {
  it('should subtract written-off units from what is expected', () => {
    expect(expectedQuantity(counters({ notReturnedQuantityAdvised: 2 }))).toBe(3);
  });

  it('should count received units neither restocked nor scrapped', () => {
    expect(
      undisposedQuantity(counters({ quantityReceived: 5, quantityRestocked: 2, quantityScrapped: 1 }))
    ).toBe(2);
  });
});
