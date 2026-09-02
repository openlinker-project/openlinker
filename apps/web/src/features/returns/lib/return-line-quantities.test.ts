/**
 * Return line quantity derivations (#2380)
 *
 * These bounds are what the forms default to AND what they refuse past, so a
 * wrong answer here is a form that pre-fills a quantity the server will reject.
 *
 * @module apps/web/src/features/returns/lib
 */
import { describe, expect, it } from 'vitest';
import {
  canMarkNotReturned,
  outstandingToDispose,
  outstandingToReceive,
} from './return-line-quantities';
import type { ReturnLine } from '../api/returns.types';

function line(overrides: Partial<ReturnLine> = {}): ReturnLine {
  return {
    id: 'line-1',
    quantityAdvised: 5,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
    custodyState: 'advised',
    ...overrides,
  } as ReturnLine;
}

describe('outstandingToReceive', () => {
  it('should be everything still expected', () => {
    expect(outstandingToReceive(line({ quantityAdvised: 5, quantityReceived: 2 }))).toBe(3);
  });

  it('should floor at zero rather than go negative', () => {
    // Counters reconciled elsewhere must not yield a negative default.
    expect(outstandingToReceive(line({ quantityAdvised: 2, quantityReceived: 5 }))).toBe(0);
  });
});

describe('outstandingToDispose', () => {
  it('should be the received units not yet restocked or scrapped', () => {
    expect(
      outstandingToDispose(
        line({ quantityReceived: 6, quantityRestocked: 2, quantityScrapped: 1 }),
      ),
    ).toBe(3);
  });

  it('should still count units whose restock was BLOCKED as outstanding', () => {
    // A blocked restock leaves its units in `quantityReceived` precisely so
    // nothing reports them as dealt with — including this.
    expect(outstandingToDispose(line({ quantityReceived: 4, quantityRestocked: 0 }))).toBe(4);
  });
});

describe('canMarkNotReturned', () => {
  it.each(['advised', 'in_transit'])('should allow a %s line with nothing received', (state) => {
    expect(canMarkNotReturned(line({ custodyState: state }))).toBe(true);
  });

  it('should refuse once any unit has arrived', () => {
    // The model has no counter for a shortfall, so the control must not offer
    // what the server refuses — that refusal would be discovered by clicking.
    expect(canMarkNotReturned(line({ quantityReceived: 1 }))).toBe(false);
  });

  it('should refuse a line the source advised no units of', () => {
    expect(canMarkNotReturned(line({ quantityAdvised: 0 }))).toBe(false);
  });

  it.each(['received', 'disposed', 'not_returned'])('should refuse a %s line', (state) => {
    expect(canMarkNotReturned(line({ custodyState: state }))).toBe(false);
  });
});
