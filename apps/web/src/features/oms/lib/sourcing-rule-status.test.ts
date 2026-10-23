/**
 * Sourcing-rule status + live predicate (#3057)
 *
 * Two properties carry weight. `unrecognised` must win over the window, and
 * `isLiveSourcingRule` must NOT be derived from the display status - the
 * reorder body is wrong in a different direction for each mistake.
 */
import { describe, expect, it } from 'vitest';

import type { SourcingRule } from '../api/sourcing-rules.types';
import { isLiveSourcingRule, resolveSourcingRuleStatus } from './sourcing-rule-status';

const NOW = new Date('2026-09-14T12:00:00.000Z');

function rule(overrides: Partial<SourcingRule> = {}): SourcingRule {
  return {
    id: 'rule_1',
    connectionId: 'conn_1',
    position: 1,
    kind: 'filter',
    name: 'in-stock',
    afterAction: 'quantity-split',
    priorityLocationIds: [],
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    recognised: true,
    ...overrides,
  };
}

describe('resolveSourcingRuleStatus', () => {
  it('reports an unbounded recognised rule as active', () => {
    expect(resolveSourcingRuleStatus(rule(), NOW).status).toBe('active');
  });

  it('reports a future start as scheduled', () => {
    expect(
      resolveSourcingRuleStatus(rule({ effectiveFrom: '2026-10-01T00:00:00.000Z' }), NOW).status
    ).toBe('scheduled');
  });

  it('reports a past end as retired', () => {
    expect(
      resolveSourcingRuleStatus(rule({ effectiveTo: '2026-09-01T00:00:00.000Z' }), NOW).status
    ).toBe('retired');
  });

  it('reports an open window as active', () => {
    expect(
      resolveSourcingRuleStatus(
        rule({ effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveTo: '2026-10-01T00:00:00.000Z' }),
        NOW
      ).status
    ).toBe('active');
  });

  it('lets unrecognised WIN over an otherwise-active window', () => {
    // The router ignores it whatever the dates say; reporting Active would be a
    // confident false statement about an order OL will never apply.
    expect(resolveSourcingRuleStatus(rule({ recognised: false }), NOW).status).toBe('unrecognised');
  });

  it('lets unrecognised win over a retired window too', () => {
    expect(
      resolveSourcingRuleStatus(
        rule({ recognised: false, effectiveTo: '2026-01-01T00:00:00.000Z' }),
        NOW
      ).status
    ).toBe('unrecognised');
  });

  it('treats an unparseable bound as absent rather than as NaN', () => {
    // A NaN comparison is false against everything, which would report a
    // retired rule as active.
    expect(resolveSourcingRuleStatus(rule({ effectiveTo: 'not-a-date' }), NOW).status).toBe(
      'active'
    );
  });
});

describe('isLiveSourcingRule', () => {
  it('counts a scheduled rule as live', () => {
    // It already claims its (kind, name) slot and is part of the reorder set;
    // omitting it answers 409 missingRuleIds.
    expect(isLiveSourcingRule({ effectiveTo: null }, NOW)).toBe(true);
  });

  it('counts an unrecognised but unexpired rule as live', () => {
    // `recognised` does not enter the backend's predicate at all.
    expect(isLiveSourcingRule({ effectiveTo: '2026-10-01T00:00:00.000Z' }, NOW)).toBe(true);
  });

  it('counts an unrecognised AND retired rule as NOT live', () => {
    // The display status says `unrecognised` here, so a status-derived
    // predicate would name it in the reorder body as an unknown id.
    expect(isLiveSourcingRule({ effectiveTo: '2026-01-01T00:00:00.000Z' }, NOW)).toBe(false);
  });
});
