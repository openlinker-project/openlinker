/**
 * Gift attention tests (#3940)
 */
import { describe, expect, it } from 'vitest';
import type { AutomationRun } from '../../automation';
import { readGiftAttention } from './gift-attention';

function run(overrides: Partial<AutomationRun> & { detail?: string | null } = {}): AutomationRun {
  const { detail = 'No gift added: gift-out-of-stock.', ...rest } = overrides;
  return {
    id: 'run-1',
    ruleId: 'rule-1',
    ruleName: 'Sample promotion',
    trigger: 'order.ingested',
    subjectKind: 'order',
    subjectId: 'o1',
    outcome: 'nothing-to-do',
    steps: [
      {
        stepIndex: 0,
        action: 'add-gift',
        status: 'nothing-to-do',
        detail,
        report: null,
        syncJobId: null,
        unavailableReason: null,
      },
    ],
    unreadableStepCount: 0,
    blockedByRuleIds: null,
    firedAt: '2026-11-02T10:00:00.000Z',
    needsAttention: false,
    retryable: false,
    retryRefusalReason: null,
    dismissedAt: null,
    dismissedByUserId: null,
    retryOfRunId: null,
    supersededByRetry: false,
    ...rest,
  };
}

describe('readGiftAttention', () => {
  it('should name an out-of-stock gift from the run the evaluator recorded', () => {
    expect(readGiftAttention([run()])).toEqual([
      { kind: 'out-of-stock', ruleId: 'rule-1', ruleName: 'Sample promotion', firedAt: '2026-11-02T10:00:00.000Z' },
    ]);
  });

  it.each([
    ['paused-unit-cap', 'limit-reached'],
    ['unit-cap-reached', 'limit-reached'],
    ['customer-limit-reached', 'customer-limit'],
    ['customer-unknown', 'customer-unknown'],
    ['below-per-unit-threshold', 'below-threshold'],
    ['superseded-by-earlier-rule', 'superseded'],
    ['gift-stock-unknown', 'stock-unknown'],
  ])('should read %s as %s', (reason, kind) => {
    expect(readGiftAttention([run({ detail: `No gift added: ${reason}.` })])[0].kind).toBe(kind);
  });

  it('should keep a reason it does not know as a generic notice instead of a different one', () => {
    expect(readGiftAttention([run({ detail: 'No gift added: something-new.' })])[0].kind).toBe('other');
  });

  it('should list a rule that failed outright', () => {
    expect(readGiftAttention([run({ outcome: 'failed', detail: 'Gift not added to order o1: boom' })])[0].kind).toBe(
      'failed',
    );
  });

  it('should not list a gift that was given, one already in the order, or a handled run', () => {
    expect(readGiftAttention([run({ outcome: 'done', detail: 'Added 1 gift unit(s) to the order.' })])).toEqual([]);
    expect(readGiftAttention([run({ detail: 'No gift added: gift-already-in-order.' })])).toEqual([]);
    expect(readGiftAttention([run({ dismissedAt: '2026-11-03T00:00:00.000Z' })])).toEqual([]);
  });

  it('should ignore other triggers and read only the newest run of a rule', () => {
    const older = run({ id: 'a', firedAt: '2026-11-01T00:00:00.000Z', detail: 'No gift added: gift-out-of-stock.' });
    const newer = run({ id: 'b', firedAt: '2026-11-02T00:00:00.000Z', detail: 'No gift added: unit-cap-reached.' });
    const other = run({ id: 'c', trigger: 'order.packed' });

    const items = readGiftAttention([older, newer, other]);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('limit-reached');
  });

  it('reads the structured reason code and prefers it over the sentence', () => {
    const base = run({ detail: 'No gift added: something-reworded.' });
    base.steps[0] = { ...base.steps[0], reasonCode: 'gift-out-of-stock' };
    expect(readGiftAttention([base]).map((i) => i.kind)).toEqual(['out-of-stock']);
  });

  it('does not list a rule skipped because the gift is already in the order', () => {
    const base = run({ detail: 'No gift added: gift-already-in-order.' });
    base.steps[0] = { ...base.steps[0], reasonCode: 'gift-already-in-order' };
    expect(readGiftAttention([base])).toEqual([]);
  });
});
