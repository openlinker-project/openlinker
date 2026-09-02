/**
 * Return Custody Transitions — unit tests (#2367)
 *
 * @module libs/core/src/returns/domain/domain-services
 */
import { ReturnCustodyStateValues, type ReturnCustodyState } from '../types/return-line.types';
import { ReturnCustodyTransitionError } from '../exceptions/return-custody-transition.error';
import {
  advanceReturnCustodyToInTransit,
  applyReturnCustodyDisposition,
  applyReturnCustodyReceipt,
  isReturnCustodyFinished,
  markReturnCustodyNotReturned,
  type ReturnCustodyLineFacts,
} from './return-custody-transitions.domain-service';

const AT = new Date('2026-08-26T10:00:00.000Z');
const LATER = new Date('2026-08-26T12:00:00.000Z');

function line(overrides: Partial<ReturnCustodyLineFacts> = {}): ReturnCustodyLineFacts {
  return {
    custodyState: 'advised',
    quantityAdvised: 5,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
    receivedAt: null,
    disposedAt: null,
    ...overrides,
  };
}

function refusalReason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ReturnCustodyTransitionError);
    return (error as ReturnCustodyTransitionError).reason;
  }
  throw new Error('expected the transition to be refused');
}

describe('return custody transitions', () => {
  describe('reachability', () => {
    it('should reach every declared custody value through a named transition', () => {
      const reached = new Set<ReturnCustodyState>(['advised']);

      reached.add(advanceReturnCustodyToInTransit(line(), { observedAt: AT }).custodyState);
      reached.add(applyReturnCustodyReceipt(line(), { quantity: 2, at: AT }).custodyState);
      reached.add(
        applyReturnCustodyDisposition(line({ custodyState: 'received', quantityReceived: 2 }), {
          quantity: 2,
          disposition: 'restock',
          at: AT,
        }).custodyState
      );
      reached.add(markReturnCustodyNotReturned(line()).custodyState);

      expect([...reached].sort()).toEqual([...ReturnCustodyStateValues].sort());
    });
  });

  describe('isReturnCustodyFinished', () => {
    it.each([
      ['advised', false],
      ['in_transit', false],
      ['received', false],
      ['disposed', true],
      ['not_returned', true],
    ] as const)('should report %s as finished=%s', (state, expected) => {
      expect(isReturnCustodyFinished(state)).toBe(expected);
    });

    it('should throw when handed a value outside the union', () => {
      expect(() => isReturnCustodyFinished('inspected' as unknown as ReturnCustodyState)).toThrow(
        /Unhandled union member/
      );
    });
  });

  describe('advanceReturnCustodyToInTransit', () => {
    it('should move an advised line to in_transit without touching counters', () => {
      const outcome = advanceReturnCustodyToInTransit(line(), { observedAt: AT });

      expect(outcome).toEqual({
        custodyState: 'in_transit',
        quantityReceived: 0,
        quantityRestocked: 0,
        quantityScrapped: 0,
        receivedAt: null,
        disposedAt: null,
      });
    });

    it.each(['in_transit', 'received', 'disposed', 'not_returned'] as const)(
      'should refuse an illegal transition from %s',
      (custodyState) => {
        expect(
          refusalReason(() =>
            advanceReturnCustodyToInTransit(line({ custodyState }), { observedAt: AT })
          )
        ).toBe('illegal-transition');
      }
    );
  });

  describe('applyReturnCustodyReceipt', () => {
    it.each(['advised', 'in_transit'] as const)(
      'should move a %s line to received and stamp receivedAt',
      (custodyState) => {
        const outcome = applyReturnCustodyReceipt(line({ custodyState }), {
          quantity: 2,
          at: AT,
        });

        expect(outcome.custodyState).toBe('received');
        expect(outcome.quantityReceived).toBe(2);
        expect(outcome.receivedAt).toBe(AT);
      }
    );

    it('should hold a partially received line in received with the shortfall visible', () => {
      const outcome = applyReturnCustodyReceipt(line({ quantityAdvised: 5 }), {
        quantity: 3,
        at: AT,
      });

      expect(outcome.custodyState).toBe('received');
      expect(outcome.quantityReceived).toBe(3);
      expect(isReturnCustodyFinished(outcome.custodyState)).toBe(false);
    });

    it('should stamp receivedAt only once across successive receipts', () => {
      const outcome = applyReturnCustodyReceipt(
        line({ custodyState: 'received', quantityReceived: 1, receivedAt: AT }),
        { quantity: 1, at: LATER }
      );

      expect(outcome.quantityReceived).toBe(2);
      expect(outcome.receivedAt).toBe(AT);
    });

    it('should re-open a disposed line and clear its disposedAt when more units arrive', () => {
      const outcome = applyReturnCustodyReceipt(
        line({
          custodyState: 'disposed',
          quantityReceived: 2,
          quantityRestocked: 2,
          receivedAt: AT,
          disposedAt: AT,
        }),
        { quantity: 1, at: LATER }
      );

      expect(outcome.custodyState).toBe('received');
      expect(outcome.disposedAt).toBeNull();
    });

    it('should refuse a receipt beyond the advised quantity', () => {
      expect(
        refusalReason(() =>
          applyReturnCustodyReceipt(line({ quantityAdvised: 2 }), { quantity: 3, at: AT })
        )
      ).toBe('over-receipt');
    });

    it.each([0, -1, 1.5])('should refuse a quantity of %s', (quantity) => {
      expect(refusalReason(() => applyReturnCustodyReceipt(line(), { quantity, at: AT }))).toBe(
        'non-positive-quantity'
      );
    });

    it('should refuse a receipt on a line already marked not returned', () => {
      expect(
        refusalReason(() =>
          applyReturnCustodyReceipt(line({ custodyState: 'not_returned' }), {
            quantity: 1,
            at: AT,
          })
        )
      ).toBe('illegal-transition');
    });
  });

  describe('applyReturnCustodyDisposition', () => {
    it('should stay in received while units remain undealt-with', () => {
      const outcome = applyReturnCustodyDisposition(
        line({ custodyState: 'received', quantityReceived: 3, receivedAt: AT }),
        { quantity: 1, disposition: 'restock', at: LATER }
      );

      expect(outcome.custodyState).toBe('received');
      expect(outcome.quantityRestocked).toBe(1);
      expect(outcome.disposedAt).toBeNull();
    });

    it('should reach disposed and stamp disposedAt once every received unit is dealt with', () => {
      const outcome = applyReturnCustodyDisposition(
        line({
          custodyState: 'received',
          quantityReceived: 3,
          quantityRestocked: 1,
          receivedAt: AT,
        }),
        { quantity: 2, disposition: 'scrap', at: LATER }
      );

      expect(outcome.custodyState).toBe('disposed');
      expect(outcome.quantityScrapped).toBe(2);
      expect(outcome.disposedAt).toBe(LATER);
    });

    it('should hold two states across a return whose lines are received unevenly', () => {
      const received = applyReturnCustodyReceipt(line({ quantityAdvised: 2 }), {
        quantity: 2,
        at: AT,
      });
      const disposed = applyReturnCustodyDisposition(
        line({ custodyState: 'received', quantityReceived: 2, receivedAt: AT }),
        { quantity: 2, disposition: 'restock', at: LATER }
      );

      expect(received.custodyState).toBe('received');
      expect(disposed.custodyState).toBe('disposed');
    });

    it('should refuse disposing more than arrived', () => {
      expect(
        refusalReason(() =>
          applyReturnCustodyDisposition(line({ custodyState: 'received', quantityReceived: 1 }), {
            quantity: 2,
            disposition: 'scrap',
            at: AT,
          })
        )
      ).toBe('over-disposition');
    });

    it.each(['advised', 'in_transit', 'not_returned'] as const)(
      'should refuse a disposition from %s',
      (custodyState) => {
        expect(
          refusalReason(() =>
            applyReturnCustodyDisposition(line({ custodyState }), {
              quantity: 1,
              disposition: 'restock',
              at: AT,
            })
          )
        ).toBe('illegal-transition');
      }
    );

    it('should refuse a non-positive quantity', () => {
      expect(
        refusalReason(() =>
          applyReturnCustodyDisposition(line({ custodyState: 'received', quantityReceived: 2 }), {
            quantity: 0,
            disposition: 'restock',
            at: AT,
          })
        )
      ).toBe('non-positive-quantity');
    });
  });

  describe('markReturnCustodyNotReturned', () => {
    it.each(['advised', 'in_transit'] as const)(
      'should mark a %s line not returned',
      (custodyState) => {
        const outcome = markReturnCustodyNotReturned(line({ custodyState }));

        expect(outcome.custodyState).toBe('not_returned');
        expect(isReturnCustodyFinished(outcome.custodyState)).toBe(true);
      }
    );

    // Through the REAL path — a receipt moves the line to `received`, so this
    // is the state a partially delivered parcel is actually in. The previous
    // version of this test used an `in_transit` line with received units, which
    // the receipt transition never produces, and so passed against a reason the
    // rule could not emit for any reachable line (#2380).
    it('should refuse a partially received line rather than invent a shortfall counter', () => {
      const partial = applyReturnCustodyReceipt(line({ quantityAdvised: 5 }), {
        quantity: 2,
        at: AT,
      });

      expect(
        refusalReason(() =>
          markReturnCustodyNotReturned(
            line({
              custodyState: partial.custodyState,
              quantityReceived: partial.quantityReceived,
            })
          )
        )
      ).toBe('partially-received');
    });

    it.each(['disposed', 'not_returned'] as const)(
      'should refuse a finished line in %s as an illegal transition',
      (custodyState) => {
        expect(refusalReason(() => markReturnCustodyNotReturned(line({ custodyState })))).toBe(
          'illegal-transition'
        );
      }
    );

    // A `received` line with nothing received cannot arise from the receipt
    // transition, but the arm has to answer something — and "already finished"
    // is the honest answer for a state no forward move exists from.
    it('should refuse a received line with no units as an illegal transition', () => {
      expect(
        refusalReason(() => markReturnCustodyNotReturned(line({ custodyState: 'received' })))
      ).toBe('illegal-transition');
    });

    // The act this move mints carries the shortfall as its quantity, and
    // `CHK_return_line_events_quantity_positive` refuses a zero. Naming the
    // refusal here is what keeps it a 409 with a code rather than a raw driver
    // error surfacing as a 500.
    it('should refuse a line the source advised no units of, with its own reason', () => {
      expect(refusalReason(() => markReturnCustodyNotReturned(line({ quantityAdvised: 0 })))).toBe(
        'nothing-advised'
      );
    });

    it('should report the shortfall as the whole advised quantity, since nothing arrived', () => {
      const facts = line({ quantityAdvised: 4 });
      const outcome = markReturnCustodyNotReturned(facts);

      // What the act's quantity is computed from at the call site. Asserted
      // here because a receipt landing first is the ONLY way these differ, and
      // that case is refused above — so this equality is the rule's guarantee,
      // not an incidental fact about the fixture.
      expect(facts.quantityAdvised - outcome.quantityReceived).toBe(4);
      expect(outcome.quantityReceived).toBe(0);
    });
  });
});
