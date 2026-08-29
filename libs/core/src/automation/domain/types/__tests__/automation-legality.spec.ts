/**
 * Automation Legality Matrix Tests (#2359, Wave-2 spec §5.4)
 *
 * The AC asks for a table-driven test over **all 48 cells**, so the expected
 * matrix is transcribed here independently of the implementation — from the
 * spec's own rendering, `✓` as `true` and `—` as `false`. A test that imported
 * the map and asserted against itself would pass for any matrix at all.
 */
import {
  AUTOMATION_LEGAL_ACTIONS,
  AUTOMATION_LEGAL_CONDITION_FIELDS,
  isLegalAutomationConditionField,
  isLegalAutomationPair,
  legalActionsForTrigger,
} from '../automation-legality.types';
import { AutomationActionValues } from '../automation-action.types';
import { AutomationTriggerValues } from '../automation-trigger.types';

/** Spec §5.4, transcribed by hand. Columns in A1–A6 order. */
const SPEC_MATRIX: Record<string, readonly boolean[]> = {
  //                                   A1     A2     A3     A4     A5     A6
  'order.hold.placed': [false, false, false, true, false, false],
  'order.hold.released': [true, true, true, true, false, false],
  'order.on_hold_for': [false, false, false, true, false, true],
  'order.dispatch_deadline_near': [false, true, false, true, false, false],
  'order.packed': [true, true, true, true, false, false],
  'return.received': [false, false, false, true, false, false],
  'return.disposed': [false, false, true, true, false, false],
  'inventory.reservation_shortfall': [false, false, false, true, true, false],
};

describe('automation legality matrix', () => {
  it('should cover exactly the eight triggers and six actions (48 cells)', () => {
    expect(Object.keys(AUTOMATION_LEGAL_ACTIONS).sort()).toEqual([...AutomationTriggerValues].sort());
    let cells = 0;
    for (const trigger of AutomationTriggerValues) {
      expect(Object.keys(AUTOMATION_LEGAL_ACTIONS[trigger]).sort()).toEqual(
        [...AutomationActionValues].sort(),
      );
      cells += Object.keys(AUTOMATION_LEGAL_ACTIONS[trigger]).length;
    }
    expect(cells).toBe(48);
  });

  describe.each(AutomationTriggerValues)('trigger %s', (trigger) => {
    it.each(AutomationActionValues.map((action, index) => [action, index] as const))(
      'should match the spec for action %s',
      (action, index) => {
        expect(isLegalAutomationPair(trigger, action)).toBe(SPEC_MATRIX[trigger][index]);
      },
    );
  });

  it('should treat an unrecognised trigger as illegal for every action', () => {
    // The repository casts an unrecognised persisted trigger through (#2358);
    // a miss must never authorise a money-spending action.
    for (const action of AutomationActionValues) {
      expect(isLegalAutomationPair('order.teleported', action)).toBe(false);
    }
    expect(legalActionsForTrigger('order.teleported')).toEqual([]);
  });

  it('should treat an unrecognised action as illegal for every trigger', () => {
    for (const trigger of AutomationTriggerValues) {
      expect(isLegalAutomationPair(trigger, 'mark-packed')).toBe(false);
    }
  });

  it('should list legal actions in the spec A1-A6 order', () => {
    expect(legalActionsForTrigger('order.packed')).toEqual([
      'issue-sales-document',
      'dispatch-shipment',
      'relay-status-to-source',
      'send-email',
    ]);
  });

  it('should make send-email legal for every trigger', () => {
    for (const trigger of AutomationTriggerValues) {
      expect(isLegalAutomationPair(trigger, 'send-email')).toBe(true);
    }
  });

  describe('condition-field legality (spec §5.5 divergence 2)', () => {
    it('should offer holdReason only for T1/T2/T3', () => {
      const withHoldReason = AutomationTriggerValues.filter((trigger) =>
        isLegalAutomationConditionField(trigger, 'holdReason'),
      );
      expect(withHoldReason).toEqual([
        'order.hold.placed',
        'order.hold.released',
        'order.on_hold_for',
      ]);
    });

    it('should offer the other three fields for every trigger', () => {
      for (const trigger of AutomationTriggerValues) {
        for (const field of ['sourceConnection', 'orderCountry', 'orderTotalGross'] as const) {
          expect(isLegalAutomationConditionField(trigger, field)).toBe(true);
        }
      }
      expect(Object.keys(AUTOMATION_LEGAL_CONDITION_FIELDS).sort()).toEqual(
        [...AutomationTriggerValues].sort(),
      );
    });

    it('should treat an unrecognised trigger or field as illegal', () => {
      expect(isLegalAutomationConditionField('order.teleported', 'orderCountry')).toBe(false);
      expect(isLegalAutomationConditionField('order.packed', 'buyerMood')).toBe(false);
    });
  });
});
