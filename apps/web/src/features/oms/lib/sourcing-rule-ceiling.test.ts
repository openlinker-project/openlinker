/**
 * Splitting-limit resolution (#3057)
 *
 * Three decisions are asserted here rather than left to the reader: only ACTIVE
 * rules count, `quantity-split` never governs, and a tie names EVERY rule.
 */
import { describe, expect, it } from 'vitest';

import type { SourcingRule } from '../api/sourcing-rules.types';
import { resolveSplitCeiling } from './sourcing-rule-ceiling';

const NOW = new Date('2026-09-14T12:00:00.000Z');

function rule(id: string, afterAction: string, overrides: Partial<SourcingRule> = {}): SourcingRule {
  return {
    id,
    connectionId: 'conn_1',
    position: 1,
    kind: 'sort',
    name: 'nearest',
    afterAction,
    priorityLocationIds: [],
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    recognised: true,
    ...overrides,
  };
}

describe('resolveSplitCeiling', () => {
  it('governs nobody when nothing restricts', () => {
    // quantity-split is the permissive default. Naming the rule that declares
    // it would attribute the ABSENCE of a restriction to a rule, and retiring
    // it would change nothing.
    const { ceiling, governingRuleIds } = resolveSplitCeiling(
      [rule('a', 'quantity-split'), rule('b', 'quantity-split')],
      NOW
    );

    expect(ceiling).toBe('quantity-split');
    expect(governingRuleIds).toEqual([]);
  });

  it('names the rule holding the most restrictive rung', () => {
    const { ceiling, governingRuleIds } = resolveSplitCeiling(
      [rule('a', 'quantity-split'), rule('b', 'no-split'), rule('c', 'line-split')],
      NOW
    );

    expect(ceiling).toBe('no-split');
    expect(governingRuleIds).toEqual(['b']);
  });

  it('names EVERY rule in a tie', () => {
    // Both are equally responsible; an operator retiring one and expecting the
    // limit to lift needs to see the other named.
    const { governingRuleIds } = resolveSplitCeiling(
      [rule('a', 'line-split'), rule('b', 'line-split'), rule('c', 'quantity-split')],
      NOW
    );

    expect(governingRuleIds).toEqual(['a', 'b']);
  });

  it('ignores a scheduled rule', () => {
    // It is not restricting anything yet.
    const { ceiling, governingRuleIds } = resolveSplitCeiling(
      [rule('a', 'no-split', { effectiveFrom: '2026-12-01T00:00:00.000Z' })],
      NOW
    );

    expect(ceiling).toBe('quantity-split');
    expect(governingRuleIds).toEqual([]);
  });

  it('ignores a retired rule', () => {
    const { ceiling } = resolveSplitCeiling(
      [rule('a', 'no-split', { effectiveTo: '2026-01-01T00:00:00.000Z' })],
      NOW
    );

    expect(ceiling).toBe('quantity-split');
  });

  it('ignores an unrecognised rule', () => {
    // The router cannot evaluate it, so it restricts nothing in practice.
    const { ceiling } = resolveSplitCeiling([rule('a', 'no-split', { recognised: false })], NOW);

    expect(ceiling).toBe('quantity-split');
  });

  it('answers the default for an empty ruleset', () => {
    expect(resolveSplitCeiling([], NOW)).toEqual({
      ceiling: 'quantity-split',
      governingRuleIds: [],
    });
  });
});
