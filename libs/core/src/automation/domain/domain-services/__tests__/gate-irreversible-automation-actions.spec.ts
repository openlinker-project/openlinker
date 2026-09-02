/**
 * Irreversible-Action Gate Tests (#2362, Wave-2 spec §5.5 divergence 3)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AutomationRule } from '../../entities/automation-rule.entity';
import type { AutomationAction } from '../../types/automation-action.types';
import type { AutomationTrigger } from '../../types/automation-trigger.types';
import { gateIrreversibleAutomationActions } from '../gate-irreversible-automation-actions';

const AT = new Date('2026-09-01T00:00:00.000Z');

/** A1 — irreversible. */
const ISSUE_DOC: AutomationAction = { action: 'issue-sales-document' };

/** A2 — irreversible. */
const DISPATCH: AutomationAction = {
  action: 'dispatch-shipment',
  carrierId: 'carrier-1',
  serviceId: null,
  packagePresetId: null,
  cashOnDelivery: false,
};

/** A4 — reversible. */
const EMAIL: AutomationAction = {
  action: 'send-email',
  recipient: { kind: 'address', address: 'ops@example.com' },
  subject: 'Hello',
  body: 'Something happened.',
};

/** A3 — reversible. */
const RELAY: AutomationAction = { action: 'relay-status-to-source' };

function rule(id: string, actions: readonly AutomationAction[]): AutomationRule {
  return new AutomationRule(
    id,
    `Rule ${id}`,
    'order.packed' as AutomationTrigger,
    {},
    [],
    actions,
    'hash',
    true,
    AT,
    null,
    null,
    null,
    AT,
    AT,
  );
}

const ids = (rules: readonly AutomationRule[]): string[] => rules.map((r) => r.id);

describe('gateIrreversibleAutomationActions', () => {
  it('should dispatch everything and block nothing when no rule carries an irreversible action', () => {
    const rules = [rule('a', [EMAIL]), rule('b', [RELAY]), rule('c', [EMAIL, RELAY])];

    const result = gateIrreversibleAutomationActions(rules);

    expect(ids(result.dispatchable)).toEqual(['a', 'b', 'c']);
    expect(result.blocked).toEqual([]);
  });

  it('should return an empty result when nothing matched', () => {
    const result = gateIrreversibleAutomationActions([]);

    expect(result.dispatchable).toEqual([]);
    expect(result.blocked).toEqual([]);
  });

  it('should dispatch a lone irreversible rule — one candidate is not a collision', () => {
    const rules = [rule('a', [ISSUE_DOC]), rule('b', [EMAIL])];

    const result = gateIrreversibleAutomationActions(rules);

    expect(ids(result.dispatchable)).toEqual(['a', 'b']);
    expect(result.blocked).toEqual([]);
  });

  it('should block BOTH rules and name both ids when two rules carry A1 (AC 1)', () => {
    const rules = [rule('a', [ISSUE_DOC]), rule('b', [ISSUE_DOC])];

    const result = gateIrreversibleAutomationActions(rules);

    expect(result.dispatchable).toEqual([]);
    expect(result.blocked).toEqual([
      { ruleId: 'a', collidingRuleIds: ['a', 'b'], actions: ['issue-sales-document'] },
      { ruleId: 'b', collidingRuleIds: ['a', 'b'], actions: ['issue-sales-document'] },
    ]);
  });

  it('should block both rules when two rules carry A2', () => {
    const rules = [rule('a', [DISPATCH]), rule('b', [DISPATCH])];

    const result = gateIrreversibleAutomationActions(rules);

    expect(result.dispatchable).toEqual([]);
    expect(result.blocked.map((entry) => entry.actions)).toEqual([
      ['dispatch-shipment'],
      ['dispatch-shipment'],
    ]);
  });

  it('should block every candidate when three rules carry the same irreversible action', () => {
    const rules = [rule('a', [ISSUE_DOC]), rule('b', [ISSUE_DOC]), rule('c', [ISSUE_DOC])];

    const result = gateIrreversibleAutomationActions(rules);

    expect(result.dispatchable).toEqual([]);
    expect(result.blocked.map((entry) => entry.ruleId)).toEqual(['a', 'b', 'c']);
    for (const entry of result.blocked) {
      expect(entry.collidingRuleIds).toEqual(['a', 'b', 'c']);
    }
  });

  it('should NOT treat A1 beside A2 as a collision — different resources, neither duplicates the other', () => {
    const rules = [rule('a', [ISSUE_DOC]), rule('b', [DISPATCH])];

    const result = gateIrreversibleAutomationActions(rules);

    expect(ids(result.dispatchable)).toEqual(['a', 'b']);
    expect(result.blocked).toEqual([]);
  });

  it('should dispatch reversible rules while blocking the colliding irreversible pair (AC 2)', () => {
    const rules = [
      rule('email-1', [EMAIL]),
      rule('doc-1', [ISSUE_DOC]),
      rule('email-2', [EMAIL]),
      rule('doc-2', [ISSUE_DOC]),
    ];

    const result = gateIrreversibleAutomationActions(rules);

    expect(ids(result.dispatchable)).toEqual(['email-1', 'email-2']);
    expect(result.blocked.map((entry) => entry.ruleId)).toEqual(['doc-1', 'doc-2']);
  });

  it('should block a rule entirely when only one of its irreversible actions has a rival', () => {
    // `both` carries A1 + A2; only A1 collides. A rule's steps cannot half-run,
    // so the whole rule is blocked.
    const rules = [rule('both', [ISSUE_DOC, DISPATCH]), rule('doc-rival', [ISSUE_DOC])];

    const result = gateIrreversibleAutomationActions(rules);

    expect(result.dispatchable).toEqual([]);
    expect(result.blocked).toEqual([
      { ruleId: 'both', collidingRuleIds: ['both', 'doc-rival'], actions: ['issue-sales-document'] },
      {
        ruleId: 'doc-rival',
        collidingRuleIds: ['both', 'doc-rival'],
        actions: ['issue-sales-document'],
      },
    ]);
  });

  it('should report the union of colliding actions when a rule collides on both A1 and A2', () => {
    const rules = [
      rule('both', [ISSUE_DOC, DISPATCH]),
      rule('doc-rival', [ISSUE_DOC]),
      rule('ship-rival', [DISPATCH]),
    ];

    const result = gateIrreversibleAutomationActions(rules);

    expect(result.dispatchable).toEqual([]);
    const both = result.blocked.find((entry) => entry.ruleId === 'both');
    // Ordered by `AutomationActionValues`, not by step order.
    expect(both?.actions).toEqual(['issue-sales-document', 'dispatch-shipment']);
    expect(both?.collidingRuleIds).toEqual(['both', 'doc-rival', 'ship-rival']);
    // Each rival names only ITS own collision, not the transitive closure.
    expect(result.blocked.find((entry) => entry.ruleId === 'doc-rival')?.collidingRuleIds).toEqual([
      'both',
      'doc-rival',
    ]);
    expect(result.blocked.find((entry) => entry.ruleId === 'ship-rival')?.collidingRuleIds).toEqual([
      'both',
      'ship-rival',
    ]);
  });

  it('should NOT free a rival once its partner was blocked on another action (no cascade)', () => {
    // `both` is blocked on A1, so its A2 step will never run — but freeing
    // `ship-rival` on that basis would derive a winner FROM a block, which is
    // silence-and-pick-one through the back door (ADR-041 §6).
    const rules = [
      rule('both', [ISSUE_DOC, DISPATCH]),
      rule('doc-rival', [ISSUE_DOC]),
      rule('ship-rival', [DISPATCH]),
    ];

    const result = gateIrreversibleAutomationActions(rules);

    expect(ids(result.dispatchable)).toEqual([]);
    expect(result.blocked.map((entry) => entry.ruleId)).toEqual([
      'both',
      'doc-rival',
      'ship-rival',
    ]);
  });

  it('should not treat a rule as colliding with itself when it repeats one irreversible action', () => {
    const rules = [rule('a', [ISSUE_DOC, ISSUE_DOC]), rule('b', [EMAIL])];

    const result = gateIrreversibleAutomationActions(rules);

    expect(ids(result.dispatchable)).toEqual(['a', 'b']);
    expect(result.blocked).toEqual([]);
  });

  it('should not mutate its input', () => {
    const rules = [rule('a', [ISSUE_DOC]), rule('b', [ISSUE_DOC])];
    const snapshot = ids(rules);

    gateIrreversibleAutomationActions(rules);

    expect(ids(rules)).toEqual(snapshot);
    expect(rules).toHaveLength(2);
  });

  // Same heuristic (and the same two recorded soft spots) as
  // `evaluate-automation-rules.spec.ts`: it reads the SOURCE, so it is
  // meaningful only while the suite runs from `src`, and the ban list is
  // substring-based. It exists to catch a dependency being ADDED, not to prove
  // purity formally — and purity is what lets #2363's dry run show this verdict
  // without firing anything.
  it('should be pure — no clock, no I/O, no framework', () => {
    const source = readFileSync(
      join(__dirname, '..', 'gate-irreversible-automation-actions.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      'new Date(',
      'Date.now(',
      'process.',
      'require(',
      'fetch(',
      'Math.random(',
      '@nestjs',
      'typeorm',
      'Injectable',
      'await',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('should read the shipped irreversibility map rather than restating the split', () => {
    const source = readFileSync(
      join(__dirname, '..', 'gate-irreversible-automation-actions.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain('isIrreversibleAction');
    // A hardcoded action name in the body would be a second list that can
    // disagree with `AUTOMATION_ACTION_IS_IRREVERSIBLE` on the money path.
    expect(code).not.toContain("'issue-sales-document'");
    expect(code).not.toContain("'dispatch-shipment'");
  });
});
