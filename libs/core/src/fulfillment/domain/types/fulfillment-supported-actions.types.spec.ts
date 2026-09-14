/**
 * Specs for the supported-action derivation (#2406).
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import { FULFILLMENT_HOLD_ACTIVE_LIMIT } from './fulfillment-hold.types';
import { FulfillmentRequestStatusValues } from './fulfillment-request-status.types';
import { FulfillmentWorkActionValues } from './fulfillment-work-action.types';
import { FulfillmentWorkStatusValues } from './fulfillment-work-status.types';
import {
  deriveSupportedActions,
  isTerminalFulfillmentWorkStatus,
  TERMINAL_FULFILLMENT_WORK_STATUSES,
  type SupportedActionsInput,
} from './fulfillment-supported-actions.types';

const base: SupportedActionsInput = {
  status: 'open',
  requestStatus: 'unsubmitted',
  activeHoldCount: 0,
  assignedConnectionId: null,
};

const derive = (over: Partial<SupportedActionsInput> = {}): readonly string[] =>
  deriveSupportedActions({ ...base, ...over });

describe('deriveSupportedActions', () => {
  it('should only ever return members of the shipped action vocabulary', () => {
    for (const status of FulfillmentWorkStatusValues) {
      for (const requestStatus of FulfillmentRequestStatusValues) {
        for (const activeHoldCount of [0, 1, FULFILLMENT_HOLD_ACTIVE_LIMIT]) {
          for (const assignedConnectionId of [null, 'conn-1']) {
            const actions = derive({ status, requestStatus, activeHoldCount, assignedConnectionId });
            for (const action of actions) {
              expect(FulfillmentWorkActionValues).toContain(action);
            }
            // A stable answer is what lets a client diff two reads.
            expect([...new Set(actions)]).toEqual([...actions]);
          }
        }
      }
    }
  });

  describe('the four holder replies are absent by construction', () => {
    // They are the HOLDER's answers off an executor response (#2399), never an
    // operator's act. Offering them on an operator read model would be the drift
    // this derivation exists to remove, pointing the other way.
    it.each(['accept', 'reject', 'accept_cancellation', 'reject_cancellation'])(
      'should never derive %s for any axis pair',
      (reply) => {
        for (const status of FulfillmentWorkStatusValues) {
          for (const requestStatus of FulfillmentRequestStatusValues) {
            for (const activeHoldCount of [0, 1]) {
              expect(derive({ status, requestStatus, activeHoldCount })).not.toContain(reply);
            }
          }
        }
      }
    );
  });

  describe('terminal execution states', () => {
    it.each([...TERMINAL_FULFILLMENT_WORK_STATUSES])(
      'should offer nothing but release_hold when status is %s',
      (status) => {
        expect(derive({ status })).toEqual([]);
        // A hold outliving its work must still be releasable, or the row is stuck.
        expect(derive({ status, activeHoldCount: 1 })).toEqual(['release_hold']);
      }
    );

    it('should not treat on_hold as terminal — a hold is suspension, not an ending', () => {
      expect(isTerminalFulfillmentWorkStatus('on_hold')).toBe(false);
      expect(TERMINAL_FULFILLMENT_WORK_STATUSES).not.toContain('on_hold');
    });
  });

  describe('heldness', () => {
    it('should suppress every forward-motion action while a hold is active', () => {
      const actions = derive({ status: 'scheduled', activeHoldCount: 1 });
      expect(actions).not.toContain('schedule');
      expect(actions).not.toContain('mark_in_progress');
      expect(actions).not.toContain('submit');
      expect(actions).toContain('release_hold');
    });

    it('should offer release_hold only while something is actually held', () => {
      expect(derive({ activeHoldCount: 0 })).not.toContain('release_hold');
      expect(derive({ activeHoldCount: 1 })).toContain('release_hold');
    });

    it('should stop offering hold at the active limit', () => {
      expect(derive({ activeHoldCount: FULFILLMENT_HOLD_ACTIVE_LIMIT - 1 })).toContain('hold');
      expect(derive({ activeHoldCount: FULFILLMENT_HOLD_ACTIVE_LIMIT })).not.toContain('hold');
    });

    it('should still allow a second hold for a second reason below the limit', () => {
      expect(derive({ activeHoldCount: 1 })).toContain('hold');
    });
  });

  describe('the on_hold exit', () => {
    // `activeHoldCount` is the authority on heldness, and nothing in the tree
    // writes `status = 'on_hold'`. Should a work reach it with every hold
    // released, it must not be stranded with only `hold` and `force_cancel`.
    it('should let an on_hold work with no active holds move forward again', () => {
      const actions = derive({ status: 'on_hold', activeHoldCount: 0 });
      expect(actions).toContain('schedule');
      expect(actions).toContain('mark_in_progress');
    });

    it('should not strand any non-terminal state with only hold and force_cancel', () => {
      for (const status of FulfillmentWorkStatusValues) {
        if (isTerminalFulfillmentWorkStatus(status)) continue;
        const forward = derive({ status, activeHoldCount: 0 }).filter(
          (a) => a !== 'hold' && a !== 'force_cancel'
        );
        expect(forward.length).toBeGreaterThan(0);
      }
    });
  });

  describe('submit — legality is derived here even though the service gates its exposure', () => {
    it('should require an assigned holder', () => {
      expect(derive({ assignedConnectionId: null })).not.toContain('submit');
      expect(derive({ assignedConnectionId: 'conn-1' })).toContain('submit');
    });

    it('should be legal from unsubmitted and from rejected, but not from submitted', () => {
      const at = (requestStatus: SupportedActionsInput['requestStatus']): readonly string[] =>
        derive({ assignedConnectionId: 'conn-1', requestStatus });
      expect(at('unsubmitted')).toContain('submit');
      expect(at('rejected')).toContain('submit');
      expect(at('submitted')).not.toContain('submit');
      expect(at('accepted')).not.toContain('submit');
    });
  });

  describe('request_cancellation', () => {
    it('should be legal only once a holder has accepted', () => {
      for (const requestStatus of FulfillmentRequestStatusValues) {
        const expected = requestStatus === 'accepted';
        expect(derive({ requestStatus }).includes('request_cancellation')).toBe(expected);
      }
    });
  });

  describe('close', () => {
    it('should require in_progress', () => {
      for (const status of FulfillmentWorkStatusValues) {
        expect(derive({ status }).includes('close')).toBe(status === 'in_progress');
      }
    });

    it('should never be offered for observation-only work still sitting at open', () => {
      // `omp_fulfilled` work "may never leave `open`"; its only terminal is
      // `force_cancel`, which ADR-054 keeps distinct from completion.
      expect(derive({ status: 'open' })).not.toContain('close');
      expect(derive({ status: 'open' })).toContain('force_cancel');
    });
  });

  describe('force_cancel', () => {
    it('should be available from every non-terminal state and no terminal one', () => {
      for (const status of FulfillmentWorkStatusValues) {
        expect(derive({ status }).includes('force_cancel')).toBe(
          !isTerminalFulfillmentWorkStatus(status)
        );
      }
    });
  });
});

describe('the expedite pair (#2416, spec D22)', () => {
  it('should offer exactly ONE direction, never both', () => {
    // The whole reason expedite is two verbs: the server says which way the
    // control points, so no client ever derives it.
    expect(derive({ isExpedited: false })).toContain('expedite');
    expect(derive({ isExpedited: false })).not.toContain('release_expedite');

    expect(derive({ isExpedited: true })).toContain('release_expedite');
    expect(derive({ isExpedited: true })).not.toContain('expedite');
  });

  it('should treat an ABSENT flag as not expedited', () => {
    // A caller compiled against the pre-#2416 shape passes nothing. It must
    // degrade to offering the forward verb, whose write is then refused by its
    // own state guard — never to offering the reverse of the truth.
    expect(derive({})).toContain('expedite');
    expect(derive({})).not.toContain('release_expedite');
  });

  it('should still offer it on a HELD parcel', () => {
    // A hold will be released, and the ordering should already be right when it
    // is. Suppressing it would make an operator release the hold to reorder.
    const held = derive({ activeHoldCount: 1, isExpedited: false });
    expect(held).toContain('expedite');
  });

  it('should offer NEITHER on a terminal parcel', () => {
    // Reordering work that will never be packed is noise on a row whose only
    // honest state is "do not pack this".
    for (const status of TERMINAL_FULFILLMENT_WORK_STATUSES) {
      expect(derive({ status, isExpedited: false })).not.toContain('expedite');
      expect(derive({ status, isExpedited: true })).not.toContain('release_expedite');
    }
  });
});
