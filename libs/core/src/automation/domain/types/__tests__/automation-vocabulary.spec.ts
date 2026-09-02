/**
 * Automation vocabulary specs (#2358)
 *
 * Covers the four closed vocabularies and their narrowers. The narrowers are
 * the read-path contract — a malformed persisted value must return `false`
 * rather than throw — so the "never throws" property is asserted directly
 * rather than left implied by a passing happy path.
 *
 * @module libs/core/src/automation/domain/types/__tests__
 */
import {
  AUTOMATION_TRIGGER_FIRING_MODE,
  AutomationTriggerValues,
  isAutomationTrigger,
  isDeadlineSweepTrigger,
} from '../automation-trigger.types';
import { isAutomationTriggerConfig } from '../automation-trigger-config.types';
import {
  AutomationConditionFieldValues,
  isAutomationCondition,
} from '../automation-condition.types';
import {
  AUTOMATION_ACTION_MAX_STEPS,
  AutomationActionValues,
  isAutomationAction,
  isAutomationActionKind,
  isIrreversibleAction,
} from '../automation-action.types';
import {
  isAutomationRunOutcome,
  isAutomationRunSubjectKind,
} from '../automation-run.types';

const MALFORMED: unknown[] = [null, undefined, 0, '', 'x', [], [1], true, { field: 'nope' }];

describe('automation trigger vocabulary', () => {
  it('should declare exactly the eight v1 triggers when read', () => {
    expect(AutomationTriggerValues).toHaveLength(8);
  });

  it('should classify exactly two triggers as deadline sweeps when read', () => {
    const sweeps = AutomationTriggerValues.filter(isDeadlineSweepTrigger);
    expect(sweeps).toEqual(['order.on_hold_for', 'order.dispatch_deadline_near']);
  });

  it('should declare a firing mode for every trigger when the map is read', () => {
    for (const trigger of AutomationTriggerValues) {
      expect(AUTOMATION_TRIGGER_FIRING_MODE[trigger]).toBeDefined();
    }
  });

  it('should reject an unknown trigger without throwing when narrowed', () => {
    for (const value of MALFORMED) {
      expect(() => isAutomationTrigger(value)).not.toThrow();
      expect(isAutomationTrigger(value)).toBe(false);
    }
  });
});

describe('automation trigger config narrowing', () => {
  it('should accept an empty config for a parameterless trigger when narrowed', () => {
    expect(isAutomationTriggerConfig('order.packed', {})).toBe(true);
  });

  it('should reject parameters supplied to a parameterless trigger when narrowed', () => {
    expect(isAutomationTriggerConfig('order.packed', { withinHours: 48 })).toBe(false);
  });

  it('should accept a positive threshold for the on-hold-for trigger when narrowed', () => {
    expect(isAutomationTriggerConfig('order.on_hold_for', { withinHours: 48 })).toBe(true);
  });

  it('should reject a non-positive or fractional threshold when narrowed', () => {
    expect(isAutomationTriggerConfig('order.on_hold_for', { withinHours: 0 })).toBe(false);
    expect(isAutomationTriggerConfig('order.on_hold_for', { withinHours: -1 })).toBe(false);
    expect(isAutomationTriggerConfig('order.on_hold_for', { withinHours: 1.5 })).toBe(false);
  });

  it("should reject one trigger's config supplied against another when narrowed", () => {
    // The check is per-trigger precisely so this cannot pass as "some known shape".
    expect(isAutomationTriggerConfig('order.dispatch_deadline_near', { withinHours: 48 })).toBe(
      false,
    );
  });

  it('should reject a malformed config without throwing when narrowed', () => {
    for (const value of MALFORMED) {
      expect(() => isAutomationTriggerConfig('order.on_hold_for', value)).not.toThrow();
    }
  });
});

describe('automation condition narrowing', () => {
  it('should declare exactly the four v1 condition fields when read', () => {
    expect(AutomationConditionFieldValues).toHaveLength(4);
  });

  it('should accept a well-formed condition of each field when narrowed', () => {
    expect(isAutomationCondition({ field: 'sourceConnection', op: 'eq', value: 'conn-1' })).toBe(
      true,
    );
    expect(isAutomationCondition({ field: 'orderCountry', op: 'eq', value: 'PL' })).toBe(true);
    expect(
      isAutomationCondition({
        field: 'orderTotalGross',
        op: 'gte',
        amount: '2000.00',
        currency: 'PLN',
      }),
    ).toBe(true);
    expect(isAutomationCondition({ field: 'holdReason', op: 'eq', value: 'payment-review' })).toBe(
      true,
    );
  });

  it('should reject a hold reason outside the closed union when narrowed', () => {
    // The union is order-lifecycle's; the composer cannot add a reason.
    expect(isAutomationCondition({ field: 'holdReason', op: 'eq', value: 'nonsense' })).toBe(false);
  });

  it('should reject a JSON-number amount when narrowed', () => {
    // The amount is a decimal STRING so the narrower can check its shape.
    expect(
      isAutomationCondition({
        field: 'orderTotalGross',
        op: 'gte',
        amount: 2000,
        currency: 'PLN',
      }),
    ).toBe(false);
  });

  it('should reject an amount with more than two decimal places when narrowed', () => {
    expect(
      isAutomationCondition({
        field: 'orderTotalGross',
        op: 'lt',
        amount: '10.005',
        currency: 'PLN',
      }),
    ).toBe(false);
  });

  it('should reject a malformed currency code when narrowed', () => {
    expect(
      isAutomationCondition({ field: 'orderTotalGross', op: 'lt', amount: '1', currency: 'pln' }),
    ).toBe(false);
  });

  it('should reject an unsupported operator when narrowed', () => {
    expect(
      isAutomationCondition({
        field: 'orderTotalGross',
        op: 'gt',
        amount: '1.00',
        currency: 'PLN',
      }),
    ).toBe(false);
  });

  it('should reject a malformed condition without throwing when narrowed', () => {
    for (const value of MALFORMED) {
      expect(() => isAutomationCondition(value)).not.toThrow();
      expect(isAutomationCondition(value)).toBe(false);
    }
  });
});

describe('automation action vocabulary', () => {
  it('should declare exactly the six v1 actions when read', () => {
    expect(AutomationActionValues).toHaveLength(6);
  });

  it('should mark exactly the two money actions irreversible when read', () => {
    const irreversible = AutomationActionValues.filter(isIrreversibleAction);
    expect(irreversible).toEqual(['issue-sales-document', 'dispatch-shipment']);
  });

  it('should cap the step count at three when read', () => {
    expect(AUTOMATION_ACTION_MAX_STEPS).toBe(3);
  });

  it('should accept the parameterless actions when narrowed', () => {
    expect(isAutomationAction({ action: 'issue-sales-document' })).toBe(true);
    expect(isAutomationAction({ action: 'relay-status-to-source' })).toBe(true);
  });

  it('should accept a well-formed dispatch-shipment step when narrowed', () => {
    expect(
      isAutomationAction({
        action: 'dispatch-shipment',
        carrierId: 'dpd',
        serviceId: null,
        packagePresetId: null,
        cashOnDelivery: false,
      }),
    ).toBe(true);
  });

  it('should reject a dispatch-shipment step with no carrier when narrowed', () => {
    // A malformed money action that persisted as valid would reach an executor.
    expect(
      isAutomationAction({
        action: 'dispatch-shipment',
        carrierId: '',
        serviceId: null,
        packagePresetId: null,
        cashOnDelivery: false,
      }),
    ).toBe(false);
  });

  it('should accept both email recipient kinds when narrowed', () => {
    expect(
      isAutomationAction({
        action: 'send-email',
        recipient: { kind: 'buyer' },
        subject: 'Order',
        body: 'hi',
      }),
    ).toBe(true);
    expect(
      isAutomationAction({
        action: 'send-email',
        recipient: { kind: 'address', address: 'ops@example.com' },
        subject: '',
        body: 'hi',
      }),
    ).toBe(true);
  });

  it('should reject an email step with an empty body when narrowed', () => {
    expect(
      isAutomationAction({
        action: 'send-email',
        recipient: { kind: 'buyer' },
        subject: 'Order',
        body: '',
      }),
    ).toBe(false);
  });

  it('should accept a release-hold step naming any hold when narrowed', () => {
    expect(isAutomationAction({ action: 'release-hold', holdReason: null, note: 'done' })).toBe(
      true,
    );
  });

  it('should reject a release-hold step with no note when narrowed', () => {
    // A6's note is required, mirroring the manual release.
    expect(isAutomationAction({ action: 'release-hold', holdReason: null, note: '' })).toBe(false);
  });

  it('should reject a place-hold step with a reason outside the union when narrowed', () => {
    expect(isAutomationAction({ action: 'place-hold', reason: 'nonsense', note: '' })).toBe(false);
  });

  it('should reject a malformed action without throwing when narrowed', () => {
    for (const value of MALFORMED) {
      expect(() => isAutomationAction(value)).not.toThrow();
      expect(isAutomationAction(value)).toBe(false);
      expect(isAutomationActionKind(value)).toBe(false);
    }
  });
});

describe('automation run vocabulary', () => {
  it('should accept the two subject kinds and reject anything else when narrowed', () => {
    expect(isAutomationRunSubjectKind('order')).toBe(true);
    expect(isAutomationRunSubjectKind('return')).toBe(true);
    expect(isAutomationRunSubjectKind('shipment')).toBe(false);
  });

  it('should accept the four outcomes and reject anything else when narrowed', () => {
    for (const outcome of ['done', 'failed', 'nothing-to-do', 'blocked']) {
      expect(isAutomationRunOutcome(outcome)).toBe(true);
    }
    expect(isAutomationRunOutcome('succeeded')).toBe(false);
  });
});
