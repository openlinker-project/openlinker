/**
 * Automation Action Availability — unit tests (#2363)
 *
 * The table's whole job is that what the API REPORTS and what an executor SAYS
 * about the same action are the same sentence. These assert that property
 * rather than the strings themselves.
 */
import {
  AUTOMATION_ACTION_AVAILABILITY,
  AutomationActionValues,
  availabilityForAction,
  isIrreversibleAction,
  unavailableReasonForAction,
} from '../../..';
import { AUTOMATION_UNAVAILABLE_ACTION_REASONS } from '../../../application/services/executors/unavailable-action-executor.service';

describe('AUTOMATION_ACTION_AVAILABILITY', () => {
  it('should cover every action in the v1 vocabulary', () => {
    expect(Object.keys(AUTOMATION_ACTION_AVAILABILITY).sort()).toEqual(
      [...AutomationActionValues].sort(),
    );
  });

  it('should carry a reason for every action that is not fully available', () => {
    for (const action of AutomationActionValues) {
      const entry = availabilityForAction(action);
      if (entry.availability === 'available') {
        expect(entry.reason).toBeNull();
      } else {
        expect(entry.reason).toEqual(expect.any(String));
        expect(entry.reason?.length).toBeGreaterThan(0);
      }
    }
  });

  it('should report only relay-status-to-source as available in this build', () => {
    const available = AutomationActionValues.filter(
      (action) => availabilityForAction(action).availability === 'available',
    );
    expect(available).toEqual(['relay-status-to-source']);
  });

  it('should report send-email as partial, since the mailer is bound in the API process only', () => {
    expect(availabilityForAction('send-email').availability).toBe('partial');
  });

  it('should be the single source of the unavailable executor copy', () => {
    // Reported === enforced. If these ever diverge, an operator is told one thing
    // by the composer and another by the run log about the same action.
    for (const action of AutomationActionValues) {
      const entry = availabilityForAction(action);
      if (entry.availability !== 'unavailable') {
        expect(AUTOMATION_UNAVAILABLE_ACTION_REASONS[action]).toBeUndefined();
        continue;
      }
      expect(AUTOMATION_UNAVAILABLE_ACTION_REASONS[action]).toBe(entry.reason);
    }
  });

  it('should return null for an action this build does not recognise', () => {
    // A rule saved by a newer build. A guessed reason would be a claim about work
    // nobody scheduled.
    expect(unavailableReasonForAction('teleport-parcel')).toBeNull();
  });

  it('should mark both irreversible actions unavailable in this build', () => {
    // Not a rule — an observation worth pinning, because it is exactly why the
    // money-acknowledgement path can be exercised today without anything spending
    // money. A future slice making one of them available should read this line.
    const irreversible = AutomationActionValues.filter((action) => isIrreversibleAction(action));
    expect(irreversible).toEqual(['issue-sales-document', 'dispatch-shipment']);
    for (const action of irreversible) {
      expect(availabilityForAction(action).availability).toBe('unavailable');
    }
  });
});
