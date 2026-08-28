/**
 * Automation schema tests (#2364)
 *
 * @module apps/web/src/features/automation/api
 */
import { describe, expect, it } from 'vitest';
import {
  parseAutomationRules,
  parseAutomationRunLog,
  parseAutomationSummary,
  parseAutomationVocabulary,
} from './automation.schema';

const rule = {
  id: 'rule-1',
  name: 'Tell the marketplace',
  trigger: 'order.packed',
  triggerConfig: {},
  conditions: [],
  actions: [{ action: 'relay-status-to-source' }],
  definitionHash: 'abc',
  isActive: true,
  effectiveFrom: '2026-08-01T00:00:00.000Z',
  effectiveTo: null,
  hasIrreversibleAction: false,
  actionAvailability: [
    { action: 'relay-status-to-source', availability: 'available', reason: null },
  ],
  moneyAckByUserId: null,
  moneyAckAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('parseAutomationRules', () => {
  it('should accept null for every nullable field (#939)', () => {
    // OpenLinker serialises an absent optional as JSON `null`; a bare
    // `.optional()` rejects it and the whole row would drop.
    const parsed = parseAutomationRules([
      { ...rule, effectiveTo: null, moneyAckByUserId: null, moneyAckAt: null },
    ]);
    expect(parsed.droppedCount).toBe(0);
    expect(parsed.items[0].effectiveTo).toBeNull();
  });

  it('should accept an omitted nullable field as well as an explicit null', () => {
    const withoutEffectiveTo = { ...rule };
    delete (withoutEffectiveTo as Partial<typeof rule>).effectiveTo;
    const parsed = parseAutomationRules([withoutEffectiveTo]);
    expect(parsed.droppedCount).toBe(0);
    expect(parsed.items[0].effectiveTo).toBeNull();
  });

  it('should drop and count a malformed row rather than failing the page', () => {
    const parsed = parseAutomationRules([rule, { id: 'broken' }]);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.droppedCount).toBe(1);
  });

  it('should default a missing actionAvailability to an empty list, never invent one', () => {
    const withoutAvailability = { ...rule };
    delete (withoutAvailability as Partial<typeof rule>).actionAvailability;
    const parsed = parseAutomationRules([withoutAvailability]);
    expect(parsed.items[0].actionAvailability).toEqual([]);
  });

  it('should flag an unreadable envelope rather than reporting "no rules"', () => {
    // Zero items AND zero drops is exactly what "the server said there are
    // none" looks like, so the flag is the only thing that separates them.
    expect(parseAutomationRules({ nope: true })).toEqual({
      items: [],
      droppedCount: 0,
      envelopeUnreadable: true,
    });
  });

  it('should not flag a readable but empty envelope', () => {
    expect(parseAutomationRules([])).toEqual({
      items: [],
      droppedCount: 0,
      envelopeUnreadable: false,
    });
  });
});

describe('parseAutomationSummary', () => {
  it('should keep every trigger the server sent, zeros included', () => {
    const parsed = parseAutomationSummary([
      { trigger: 'order.packed', ruleCount: 0 },
      { trigger: 'return.received', ruleCount: 3 },
    ]);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].ruleCount).toBe(0);
  });

  it('should flag an unreadable summary envelope rather than reporting "no rules"', () => {
    expect(parseAutomationSummary({ nope: true })).toEqual({
      items: [],
      droppedCount: 0,
      envelopeUnreadable: true,
    });
    expect(parseAutomationSummary([]).envelopeUnreadable).toBe(false);
  });

  it('should drop an unrecognised trigger and count it', () => {
    const parsed = parseAutomationSummary([
      { trigger: 'order.packed', ruleCount: 1 },
      { trigger: 'order.teleported', ruleCount: 9 },
    ]);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.droppedCount).toBe(1);
  });
});

describe('parseAutomationRunLog', () => {
  it('should preserve recordingAvailable false with its note', () => {
    const parsed = parseAutomationRunLog({
      runs: [],
      limit: 50,
      hasMore: false,
      recordingAvailable: false,
      note: 'Automation runs are not recorded in this build yet.',
    });
    // The distinction the whole log turns on: empty + not-recorded is NOT
    // evidence that nothing fired.
    expect(parsed?.recordingAvailable).toBe(false);
    expect(parsed?.note).not.toBeNull();
  });

  it('should return null for an unreadable envelope rather than synthesising a verdict', () => {
    // Synthesising `{recordingAvailable: false}` would state a fact about the
    // build that the response never supplied.
    expect(parseAutomationRunLog({ runs: 'nope' })).toBeNull();
  });
});

describe('parseAutomationRunLog typing', () => {
  it('should carry parsed runs through with their fields intact', () => {
    const parsed = parseAutomationRunLog({
      runs: [
        {
          id: 'run-1',
          ruleId: 'rule-1',
          ruleName: 'Tell the marketplace',
          trigger: 'order.packed',
          subjectKind: 'order',
          subjectId: 'ol_order_1',
          outcome: 'succeeded',
          blockedByRuleIds: null,
          firedAt: '2026-08-02T00:00:00.000Z',
          needsAttention: false,
          retryable: false,
        },
      ],
      limit: 50,
      hasMore: false,
      recordingAvailable: true,
    });

    expect(parsed?.runs[0].ruleName).toBe('Tell the marketplace');
    expect(parsed?.runs[0].blockedByRuleIds).toBeNull();
  });

  it('should DROP a run missing needsAttention, silently — the cost of parsing it as required', () => {
    // Recorded as a test because it is the accepted cost of #2387's decision to
    // parse `needsAttention` as required rather than `.nullish()`. Both halves
    // ship in one deploy so this is unreachable in practice, but there is no
    // dropped-row counter (`unreadableStepCount` covers steps only), so a
    // backend that ever omits the field makes rows VANISH rather than render
    // wrong. The alternative was worse: the client would have to under-report a
    // genuinely failed run, or re-derive the rule — a second copy of it.
    const parsed = parseAutomationRunLog({
      runs: [
        {
          id: 'run-1',
          ruleId: 'rule-1',
          ruleName: 'Tell the marketplace',
          trigger: 'order.packed',
          subjectKind: 'order',
          subjectId: 'ol_order_1',
          outcome: 'failed',
          blockedByRuleIds: null,
          firedAt: '2026-08-02T00:00:00.000Z',
        },
      ],
      limit: 50,
      hasMore: false,
      recordingAvailable: true,
    });

    expect(parsed?.runs).toHaveLength(0);
  });

  it('should keep a run whose optional AF-X fields are absent', () => {
    const parsed = parseAutomationRunLog({
      runs: [
        {
          id: 'run-1',
          ruleId: 'rule-1',
          ruleName: 'Tell the marketplace',
          trigger: 'order.packed',
          subjectKind: 'order',
          subjectId: 'ol_order_1',
          outcome: 'failed',
          blockedByRuleIds: null,
          firedAt: '2026-08-02T00:00:00.000Z',
          needsAttention: true,
          retryable: true,
        },
      ],
      limit: 50,
      hasMore: false,
      recordingAvailable: true,
    });

    // The genuinely nullable ones normalise to null (#939), never to undefined.
    expect(parsed?.runs[0].dismissedAt).toBeNull();
    expect(parsed?.runs[0].retryOfRunId).toBeNull();
    expect(parsed?.runs[0].retryRefusalReason).toBeNull();
  });

  it('should drop a malformed run rather than failing the whole log', () => {
    const parsed = parseAutomationRunLog({
      runs: [{ id: 'broken' }],
      recordingAvailable: true,
    });

    expect(parsed?.runs).toHaveLength(0);
    expect(parsed?.recordingAvailable).toBe(true);
  });
});

describe('parseAutomationVocabulary', () => {
  it('should throw rather than return a partial vocabulary', () => {
    // An empty availability panel reads as "this build ships no actions" — a
    // claim. Throwing routes the page to its error branch instead.
    expect(() => parseAutomationVocabulary({ triggers: [] })).toThrow();
  });
});
