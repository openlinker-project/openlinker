/**
 * AutomationRule entity specs (#2358)
 *
 * The entity is anemic (ADR-011) and carries exactly one derivation:
 * `hasIrreversibleAction`, the seam #2362's at-most-one gate reads instead of
 * restating which actions spend money. It is covered here because a seam with
 * no test and no caller is indistinguishable from dead code — and because the
 * property it asserts (that it DELEGATES rather than restating the split) is
 * what stops the two lists drifting.
 *
 * @module libs/core/src/automation/domain/entities/__tests__
 */
import { AutomationRule } from '../automation-rule.entity';
import type { AutomationAction } from '../../types/automation-action.types';

const LABEL: AutomationAction = {
  action: 'dispatch-shipment',
  carrierId: 'dpd',
  serviceId: null,
  packagePresetId: null,
  cashOnDelivery: false,
};
const INVOICE: AutomationAction = { action: 'issue-sales-document' };
const RELAY: AutomationAction = { action: 'relay-status-to-source' };
const EMAIL: AutomationAction = {
  action: 'send-email',
  recipient: { kind: 'buyer' },
  subject: 'Order',
  body: 'hi',
};

function ruleWith(actions: readonly AutomationAction[]): AutomationRule {
  return new AutomationRule(
    'rule-1',
    'Label and tell',
    'order.packed',
    {},
    [],
    actions,
    'hash',
    true,
    new Date('2026-09-01'),
    null,
    null,
    null,
    new Date('2026-08-01'),
    new Date('2026-08-01'),
  );
}

describe('AutomationRule.hasIrreversibleAction', () => {
  it('should report true when a step buys a shipping label', () => {
    expect(ruleWith([LABEL]).hasIrreversibleAction()).toBe(true);
  });

  it('should report true when a step issues a sales document', () => {
    expect(ruleWith([INVOICE]).hasIrreversibleAction()).toBe(true);
  });

  it('should report true when only ONE of several steps is irreversible', () => {
    // The #2047 gate applies to the whole rule, not to the offending step in
    // isolation — a batch that would buy a label must not part-fire.
    expect(ruleWith([RELAY, LABEL, EMAIL]).hasIrreversibleAction()).toBe(true);
  });

  it('should report false when every step is reversible', () => {
    // Two emails are recoverable; two labels are not (spec §5.5 divergence 3).
    expect(ruleWith([RELAY, EMAIL]).hasIrreversibleAction()).toBe(false);
  });

  it('should report false for a rule with no steps', () => {
    // Unreachable through the service's 1..3 cap, but reachable via the
    // repository's drop-malformed read path, so it must not throw.
    expect(ruleWith([]).hasIrreversibleAction()).toBe(false);
  });
});
