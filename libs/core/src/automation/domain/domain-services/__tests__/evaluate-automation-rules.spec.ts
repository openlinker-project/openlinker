/**
 * Evaluate Automation Rules Tests (#2359, Wave-2 spec §5.4 / §5.5 / §5.6)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AutomationRule } from '../../entities/automation-rule.entity';
import type { AutomationAction } from '../../types/automation-action.types';
import type { AutomationCondition } from '../../types/automation-condition.types';
import type { AutomationSubjectFacts } from '../../types/automation-facts.types';
import type { AutomationTriggerConfig } from '../../types/automation-trigger-config.types';
import type { AutomationTrigger } from '../../types/automation-trigger.types';
import { evaluateAutomationRules } from '../evaluate-automation-rules';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const CREATED = new Date('2026-09-01T00:00:00.000Z');
const OCCURRED = new Date('2026-09-10T11:00:00.000Z');

const EMAIL: AutomationAction = {
  action: 'send-email',
  recipient: { kind: 'address', address: 'ops@example.com' },
  subject: 'Order {order.reference}',
  body: 'Something happened.',
};

interface RuleOverrides {
  readonly id?: string;
  /** Typed as a bare string so a spec can build the unrecognised-trigger row the repository casts through. */
  readonly trigger?: string;
  readonly triggerConfig?: AutomationTriggerConfig;
  readonly conditions?: readonly AutomationCondition[];
  readonly actions?: readonly AutomationAction[];
  readonly isActive?: boolean;
  readonly effectiveFrom?: Date;
  readonly effectiveTo?: Date | null;
  readonly createdAt?: Date;
}

function rule(overrides: RuleOverrides = {}): AutomationRule {
  return new AutomationRule(
    overrides.id ?? 'rule-1',
    'Tell ops',
    (overrides.trigger ?? 'order.packed') as AutomationTrigger,
    overrides.triggerConfig ?? {},
    overrides.conditions ?? [],
    overrides.actions ?? [EMAIL],
    'hash',
    overrides.isActive ?? true,
    overrides.effectiveFrom ?? CREATED,
    overrides.effectiveTo ?? null,
    null,
    null,
    overrides.createdAt ?? CREATED,
    CREATED,
  );
}

const FACTS: AutomationSubjectFacts = {
  subjectKind: 'order',
  subjectId: 'ol_order_1',
  occurredAt: OCCURRED,
  sourceConnectionId: 'conn-allegro',
  country: 'PL',
  totalGross: 250,
  currency: 'PLN',
};

function evaluateOne(
  r: AutomationRule,
  facts: AutomationSubjectFacts = FACTS,
  trigger: AutomationTrigger = 'order.packed',
) {
  const result = evaluateAutomationRules({ trigger, facts, rules: [r], now: NOW });
  return result.evaluations[0];
}

describe('evaluateAutomationRules', () => {
  it('should match a rule whose conditions are all true', () => {
    const result = evaluateAutomationRules({
      trigger: 'order.packed',
      facts: FACTS,
      rules: [
        rule({
          conditions: [
            { field: 'sourceConnection', op: 'eq', value: 'conn-allegro' },
            { field: 'orderCountry', op: 'eq', value: 'PL' },
            { field: 'orderTotalGross', op: 'gte', amount: '100.00', currency: 'PLN' },
          ],
        }),
      ],
      now: NOW,
    });
    expect(result.matched).toHaveLength(1);
    expect(result.evaluations[0].matches).toBe(true);
    expect(result.evaluations[0].nonFiringReason).toBeNull();
    expect(result.evaluations[0].conditionTraces.map((t) => t.outcome)).toEqual([
      'true',
      'true',
      'true',
    ]);
  });

  it('should return the trace for EVERY condition even after one fails (AC 3)', () => {
    // The dry run renders all rows; short-circuiting would make the operator
    // fix one thing, re-test, and discover the next.
    const evaluation = evaluateOne(
      rule({
        conditions: [
          { field: 'orderCountry', op: 'eq', value: 'DE' },
          { field: 'sourceConnection', op: 'eq', value: 'conn-allegro' },
          { field: 'orderTotalGross', op: 'lt', amount: '100.00', currency: 'PLN' },
        ],
      }),
    );
    expect(evaluation.matches).toBe(false);
    expect(evaluation.conditionTraces.map((t) => t.outcome)).toEqual(['false', 'true', 'false']);
    expect(evaluation.nonFiringReason).toBe('condition-not-met');
  });

  it('should report an unknown fact as unknown, never as a non-match', () => {
    const { occurredAt, subjectKind, subjectId } = FACTS;
    const evaluation = evaluateOne(
      rule({ conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }] }),
      { subjectKind, subjectId, occurredAt },
    );
    expect(evaluation.conditionTraces[0].outcome).toBe('unknown');
    expect(evaluation.nonFiringReason).toBe('condition-fact-unknown');
  });

  it('should never convert currencies — a mismatch simply does not match', () => {
    const evaluation = evaluateOne(
      rule({
        conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '10.00', currency: 'EUR' }],
      }),
    );
    expect(evaluation.conditionTraces[0].outcome).toBe('currency-mismatch');
    expect(evaluation.nonFiringReason).toBe('condition-currency-mismatch');
  });

  it('should compare gte and lt against the parsed decimal amount', () => {
    const gte = evaluateOne(
      rule({
        conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '250.00', currency: 'PLN' }],
      }),
    );
    expect(gte.matches).toBe(true);
    const lt = evaluateOne(
      rule({
        conditions: [{ field: 'orderTotalGross', op: 'lt', amount: '250.00', currency: 'PLN' }],
      }),
    );
    expect(lt.matches).toBe(false);
  });

  it('should match a holdReason condition on the hold facts', () => {
    const facts: AutomationSubjectFacts = { ...FACTS, holdReason: 'payment-review' };
    const evaluation = evaluateOne(
      rule({
        trigger: 'order.hold.placed',
        conditions: [{ field: 'holdReason', op: 'eq', value: 'payment-review' }],
      }),
      facts,
      'order.hold.placed',
    );
    expect(evaluation.matches).toBe(true);
  });

  describe('non-firing reasons are observable, never silent', () => {
    const NON_FIRING_CASES: ReadonlyArray<readonly [string, AutomationTrigger, AutomationRule]> = [
      ['trigger-mismatch', 'order.packed', rule({ trigger: 'return.received' })],
      ['unknown-trigger', 'order.packed', rule({ trigger: 'order.teleported' })],
      ['rule-inactive', 'order.packed', rule({ isActive: false })],
      [
        'not-yet-effective',
        'order.packed',
        rule({ effectiveFrom: new Date('2026-12-01T00:00:00.000Z') }),
      ],
      [
        'no-longer-effective',
        'order.packed',
        rule({ effectiveTo: new Date('2026-09-05T00:00:00.000Z') }),
      ],
      ['no-actions', 'order.packed', rule({ actions: [] })],
      [
        'illegal-trigger-action-pair',
        'return.received',
        rule({ trigger: 'return.received', actions: [{ action: 'issue-sales-document' }] }),
      ],
      [
        'trigger-config-invalid',
        'order.on_hold_for',
        rule({ trigger: 'order.on_hold_for', triggerConfig: {} }),
      ],
    ];

    it.each(NON_FIRING_CASES)('should report %s', (reason, trigger, candidate) => {
      const evaluation = evaluateOne(candidate, FACTS, trigger);
      expect(evaluation.matches).toBe(false);
      expect(evaluation.nonFiringReason).toBe(reason);
    });

    it('should never leave a non-matching rule without a reason', () => {
      const result = evaluateAutomationRules({
        trigger: 'order.packed',
        facts: FACTS,
        rules: [rule({ isActive: false }), rule({ id: 'rule-2' })],
        now: NOW,
      });
      for (const evaluation of result.evaluations) {
        expect(evaluation.matches === (evaluation.nonFiringReason === null)).toBe(true);
      }
    });
  });

  describe('retroactivity floor (spec §5.2)', () => {
    it('should not fire for a fact that predates the rule', () => {
      const evaluation = evaluateOne(rule(), {
        ...FACTS,
        occurredAt: new Date('2026-08-20T00:00:00.000Z'),
      });
      expect(evaluation.nonFiringReason).toBe('fact-precedes-rule');
    });

    it('should not fire when the fact time is unknown', () => {
      const { subjectKind, subjectId, country } = FACTS;
      const evaluation = evaluateOne(rule(), { subjectKind, subjectId, country });
      expect(evaluation.nonFiringReason).toBe('fact-time-unknown');
    });
  });

  describe('the trace is built for every IN-SCOPE rule (review finding 1)', () => {
    const CONDITIONS: readonly AutomationCondition[] = [
      { field: 'orderCountry', op: 'eq', value: 'PL' },
      { field: 'sourceConnection', op: 'eq', value: 'nope' },
    ];

    it.each([
      ['rule-inactive', rule({ isActive: false, conditions: CONDITIONS })],
      [
        'not-yet-effective',
        rule({ effectiveFrom: new Date('2026-12-01T00:00:00.000Z'), conditions: CONDITIONS }),
      ],
      ['no-actions', rule({ actions: [], conditions: CONDITIONS })],
    ])('should still trace conditions for a %s rule', (reason, candidate) => {
      const evaluation = evaluateOne(candidate);
      expect(evaluation.nonFiringReason).toBe(reason);
      // The dry run renders this table; withholding it shows the operator nothing.
      expect(evaluation.conditionTraces.map((t) => t.outcome)).toEqual(['true', 'false']);
    });

    it('should leave the trace EMPTY only for an out-of-scope rule', () => {
      for (const candidate of [
        rule({ trigger: 'return.received', conditions: CONDITIONS }),
        rule({ trigger: 'order.teleported', conditions: CONDITIONS }),
      ]) {
        expect(evaluateOne(candidate).conditionTraces).toEqual([]);
      }
    });
  });

  describe('the retroactivity floor is a firing rule, waivable only explicitly', () => {
    const PAST: AutomationSubjectFacts = {
      ...FACTS,
      occurredAt: new Date('2026-08-20T00:00:00.000Z'),
    };

    it('should default to ENFORCED when the flag is omitted', () => {
      expect(evaluateOne(rule(), PAST).nonFiringReason).toBe('fact-precedes-rule');
    });

    it('should match, and REPORT the waiver, when the dry run waives it', () => {
      const result = evaluateAutomationRules({
        trigger: 'order.packed',
        facts: PAST,
        rules: [rule()],
        now: NOW,
        enforceRetroactivityFloor: false,
      });
      expect(result.evaluations[0].matches).toBe(true);
      expect(result.evaluations[0].retroactivityFloorWaived).toBe(true);
    });

    it('should waive an unknown fact time too, and still report it', () => {
      const { subjectKind, subjectId } = FACTS;
      const result = evaluateAutomationRules({
        trigger: 'order.packed',
        facts: { subjectKind, subjectId },
        rules: [rule()],
        now: NOW,
        enforceRetroactivityFloor: false,
      });
      expect(result.evaluations[0].matches).toBe(true);
      expect(result.evaluations[0].retroactivityFloorWaived).toBe(true);
    });

    it('should not claim a waiver when the floor was never in the way', () => {
      const evaluation = evaluateOne(rule());
      expect(evaluation.matches).toBe(true);
      expect(evaluation.retroactivityFloorWaived).toBe(false);
    });

    it('should NOT let a waiver rescue a rule blocked for another reason', () => {
      const result = evaluateAutomationRules({
        trigger: 'order.packed',
        facts: PAST,
        rules: [rule({ isActive: false })],
        now: NOW,
        enforceRetroactivityFloor: false,
      });
      expect(result.evaluations[0].nonFiringReason).toBe('rule-inactive');
    });
  });

  it('should let SEVERAL rules match — the at-most-one gate is #2362, not here', () => {
    const result = evaluateAutomationRules({
      trigger: 'order.packed',
      facts: FACTS,
      rules: [
        rule({ id: 'a', actions: [{ action: 'issue-sales-document' }] }),
        rule({ id: 'b', actions: [{ action: 'issue-sales-document' }] }),
      ],
      now: NOW,
    });
    expect(result.matched.map((m) => m.ruleId)).toEqual(['a', 'b']);
  });

  it('should return one evaluation per input rule, in input order', () => {
    const result = evaluateAutomationRules({
      trigger: 'order.packed',
      facts: FACTS,
      rules: [rule({ id: 'a' }), rule({ id: 'b', isActive: false }), rule({ id: 'c' })],
      now: NOW,
    });
    expect(result.evaluations.map((e) => e.ruleId)).toEqual(['a', 'b', 'c']);
  });

  it('should not mutate its inputs', () => {
    const facts: AutomationSubjectFacts = { ...FACTS };
    const rules = [rule()];
    const snapshot = JSON.stringify({ facts, rules });
    evaluateAutomationRules({ trigger: 'order.packed', facts, rules, now: NOW });
    expect(JSON.stringify({ facts, rules })).toEqual(snapshot);
  });

  // Two known soft spots, recorded so a future reader does not rediscover them:
  // this reads the SOURCE, so it is meaningful only while the suite runs from
  // `src` (true under this package's ts-jest config, vacuous against `dist`);
  // and the ban list is substring-based, so an identifier merely containing a
  // banned word would false-positive. Both are acceptable for a heuristic whose
  // job is to catch a dependency being added, not to prove purity formally.
  it('should be pure — no clock, no I/O, no framework (AC 1)', () => {
    const source = readFileSync(join(__dirname, '..', 'evaluate-automation-rules.ts'), 'utf8');
    // Comments are stripped so prose mentioning `new Date()` cannot fail this.
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
});
