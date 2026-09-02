/**
 * Automation definition-hash specs (#2358)
 *
 * The two properties the duplicate guard depends on, asserted directly:
 * conditions are order-INDEPENDENT (they are AND-ed) and actions are
 * order-DEPENDENT (they run in order, stopping on first failure).
 *
 * The second is the one a future refactor is most likely to break by "tidying"
 * the canonicalizer into sorting both arrays, so it is asserted as an explicit
 * inequality rather than left to a happy-path equality.
 *
 * @module libs/core/src/automation/domain/types/__tests__
 */
import type {
  AutomationRuleDefinition} from '../automation-definition-hash.types';
import {
  canonicalizeAutomationDefinition,
  computeAutomationDefinitionHash,
} from '../automation-definition-hash.types';
import type { AutomationCondition } from '../automation-condition.types';
import type { AutomationAction } from '../automation-action.types';

const COUNTRY: AutomationCondition = { field: 'orderCountry', op: 'eq', value: 'PL' };
const CONNECTION: AutomationCondition = {
  field: 'sourceConnection',
  op: 'eq',
  value: 'conn-1',
};
const LABEL: AutomationAction = {
  action: 'dispatch-shipment',
  carrierId: 'dpd',
  serviceId: null,
  packagePresetId: null,
  cashOnDelivery: false,
};
const RELAY: AutomationAction = { action: 'relay-status-to-source' };

function definition(overrides: Partial<AutomationRuleDefinition> = {}): AutomationRuleDefinition {
  return {
    trigger: 'order.packed',
    triggerConfig: {},
    conditions: [COUNTRY, CONNECTION],
    actions: [LABEL, RELAY],
    ...overrides,
  };
}

describe('computeAutomationDefinitionHash', () => {
  it('should produce the same hash when conditions are reordered', () => {
    // Conditions are AND-ed, so authoring order carries no meaning — and
    // sorting them is what makes the guard catch a reordered duplicate.
    const a = computeAutomationDefinitionHash(definition({ conditions: [COUNTRY, CONNECTION] }));
    const b = computeAutomationDefinitionHash(definition({ conditions: [CONNECTION, COUNTRY] }));
    expect(a).toBe(b);
  });

  it('should produce a DIFFERENT hash when actions are reordered', () => {
    // A2 then A3 buys the label and then tells the marketplace; A3 then A2
    // tells the marketplace about a label that does not exist yet. These are
    // different rules and must not collapse into one.
    const a = computeAutomationDefinitionHash(definition({ actions: [LABEL, RELAY] }));
    const b = computeAutomationDefinitionHash(definition({ actions: [RELAY, LABEL] }));
    expect(a).not.toBe(b);
  });

  it('should produce the same hash when object keys are authored in a different order', () => {
    const reordered = {
      value: 'PL',
      op: 'eq',
      field: 'orderCountry',
    } as unknown as AutomationCondition;
    expect(computeAutomationDefinitionHash(definition({ conditions: [reordered] }))).toBe(
      computeAutomationDefinitionHash(definition({ conditions: [COUNTRY] })),
    );
  });

  it('should produce a different hash when the trigger config differs', () => {
    // Two rules differing only in threshold are genuinely different rules,
    // which is why triggerConfig is part of the identity.
    const a = computeAutomationDefinitionHash(
      definition({ trigger: 'order.on_hold_for', triggerConfig: { withinHours: 48 } }),
    );
    const b = computeAutomationDefinitionHash(
      definition({ trigger: 'order.on_hold_for', triggerConfig: { withinHours: 72 } }),
    );
    expect(a).not.toBe(b);
  });

  it('should produce a different hash when the trigger differs', () => {
    const a = computeAutomationDefinitionHash(definition({ trigger: 'order.packed' }));
    const b = computeAutomationDefinitionHash(definition({ trigger: 'return.received' }));
    expect(a).not.toBe(b);
  });

  it('should sort nested object keys when canonicalizing', () => {
    const canonical = canonicalizeAutomationDefinition(
      definition({
        actions: [
          {
            action: 'send-email',
            recipient: { kind: 'address', address: 'ops@example.com' },
            subject: 's',
            body: 'b',
          },
        ],
      }),
    );
    expect(canonical).toContain('{"address":"ops@example.com","kind":"address"}');
  });

  it('should return a 64-character hex digest', () => {
    expect(computeAutomationDefinitionHash(definition())).toMatch(/^[0-9a-f]{64}$/);
  });
});
