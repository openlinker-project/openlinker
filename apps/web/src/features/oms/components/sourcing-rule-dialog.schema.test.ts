/**
 * Sourcing-rule form schema (#3058)
 *
 * The rules worth pinning are the ones that would otherwise save happily and
 * never fire: a kind/name pair the router cannot evaluate, a window that closes
 * before it opens, and a priority list on a rule that does not rank by one.
 */
import { describe, expect, it } from 'vitest';

import {
  sourcingRuleFormSchema,
  toDateInputValue,
  toEffectiveInstant,
} from './sourcing-rule-dialog.schema';

function values(overrides: Record<string, unknown> = {}): unknown {
  return {
    kind: 'filter',
    name: 'in-stock',
    afterAction: 'line-split',
    priorityLocationIds: [],
    effectiveFrom: '',
    effectiveTo: '',
    ...overrides,
  };
}

function messagesFor(input: unknown, path: string): string[] {
  const result = sourcingRuleFormSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.filter((issue) => issue.path[0] === path).map((issue) => issue.message);
}

describe('sourcingRuleFormSchema', () => {
  it('accepts an unbounded filter rule', () => {
    expect(sourcingRuleFormSchema.safeParse(values()).success).toBe(true);
  });

  it('refuses a sort name used as a filter', () => {
    // The server refuses the pair too; a rule that saves and never fires is the
    // defect this screen exists to make impossible.
    expect(messagesFor(values({ kind: 'filter', name: 'nearest' }), 'name')).not.toHaveLength(0);
  });

  it('refuses a filter name used as a sort', () => {
    expect(messagesFor(values({ kind: 'sort', name: 'in-stock' }), 'name')).not.toHaveLength(0);
  });

  it('refuses a priority rule with an empty list', () => {
    expect(
      messagesFor(values({ kind: 'sort', name: 'priority' }), 'priorityLocationIds')
    ).not.toHaveLength(0);
  });

  it('refuses a location list on a rule that does not rank by one', () => {
    expect(
      messagesFor(values({ kind: 'sort', name: 'nearest', priorityLocationIds: ['loc_a'] }), 'priorityLocationIds')
    ).not.toHaveLength(0);
  });

  it('accepts a priority rule with a list', () => {
    const parsed = sourcingRuleFormSchema.safeParse(
      values({ kind: 'sort', name: 'priority', priorityLocationIds: ['loc_a', 'loc_b'] })
    );
    expect(parsed.success).toBe(true);
  });

  it('refuses an end date that is not after the start', () => {
    // Equal bounds describe a rule that is never in force.
    expect(
      messagesFor(values({ effectiveFrom: '2026-09-10', effectiveTo: '2026-09-10' }), 'effectiveTo')
    ).not.toHaveLength(0);
    expect(
      messagesFor(values({ effectiveFrom: '2026-09-10', effectiveTo: '2026-09-01' }), 'effectiveTo')
    ).not.toHaveLength(0);
  });

  it('accepts either bound on its own', () => {
    expect(sourcingRuleFormSchema.safeParse(values({ effectiveFrom: '2026-09-10' })).success).toBe(true);
    expect(sourcingRuleFormSchema.safeParse(values({ effectiveTo: '2026-09-10' })).success).toBe(true);
  });
});

describe('effective-bound conversion', () => {
  it('maps an empty input to null rather than to an instant', () => {
    // `null` is what the API stores for "no bound"; an empty string would be a
    // date it has to reject.
    expect(toEffectiveInstant('')).toBeNull();
  });

  it('anchors a bare date at midnight UTC', () => {
    // Not the browser's zone: the same form must not produce a different stored
    // instant for two operators in different offices.
    expect(toEffectiveInstant('2026-09-10')).toBe('2026-09-10T00:00:00.000Z');
  });

  it('round-trips a stored instant back into a date input', () => {
    expect(toDateInputValue('2026-09-10T00:00:00.000Z')).toBe('2026-09-10');
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue('not-a-date')).toBe('');
  });
});
