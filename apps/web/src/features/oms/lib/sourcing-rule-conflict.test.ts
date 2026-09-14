/**
 * Sourcing-rule refusal reader (#3056)
 *
 * The distinction that matters: a reorder mismatch carries ids the operator can
 * act on, a duplicate-rule conflict does not. Reporting `[]` for the second
 * would claim the reorder named everything, so both id fields stay `null`.
 */
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../shared/api/api-error';
import { describeSourcingRuleError, readSourcingRuleConflict } from './sourcing-rule-conflict';

describe('readSourcingRuleConflict', () => {
  it('reads the reorder mismatch ids the server emitted as fields', () => {
    const conflict = readSourcingRuleConflict(
      new ApiError('list did not name the active rules', 409, {
        message: 'list did not name the active rules',
        missingRuleIds: ['rule_2'],
        unknownRuleIds: ['rule_9'],
      })
    );

    expect(conflict?.missingRuleIds).toEqual(['rule_2']);
    expect(conflict?.unknownRuleIds).toEqual(['rule_9']);
    expect(conflict?.message).toBe('list did not name the active rules');
  });

  it('reports null ids for a 409 that carries none', () => {
    // Duplicate live (kind, name). `[]` would read as "the reorder named
    // everything", which is a different and false statement.
    const conflict = readSourcingRuleConflict(
      new ApiError('a live rule already claims this', 409, {
        message: 'a live rule already claims this',
      })
    );

    expect(conflict?.missingRuleIds).toBeNull();
    expect(conflict?.unknownRuleIds).toBeNull();
  });

  it('treats a partially-typed id array as absent', () => {
    // Filtering would hand the operator a truncated list and send them to
    // correct the wrong rules.
    const conflict = readSourcingRuleConflict(
      new ApiError('mismatch', 409, { missingRuleIds: ['rule_2', 7] })
    );

    expect(conflict?.missingRuleIds).toBeNull();
  });

  it('is null for anything that is not a 409', () => {
    expect(readSourcingRuleConflict(new ApiError('nope', 400, {}))).toBeNull();
    expect(readSourcingRuleConflict(new Error('boom'))).toBeNull();
    expect(readSourcingRuleConflict(undefined)).toBeNull();
  });
});

describe('describeSourcingRuleError', () => {
  it('uses the server sentence for a 400, which names the actual problem', () => {
    expect(
      describeSourcingRuleError(
        new ApiError('priorityLocationIds is only valid on a priority rule', 400, {}),
        'fallback'
      )
    ).toBe('priorityLocationIds is only valid on a priority rule');
  });

  it('falls back only when the error says nothing usable', () => {
    expect(describeSourcingRuleError(new ApiError('', 500, {}), 'fallback')).toBe('fallback');
  });

  it('answers the permission and missing-rule cases in its own words', () => {
    expect(describeSourcingRuleError(new ApiError('x', 403, {}), 'fallback')).toContain(
      'permission'
    );
    expect(describeSourcingRuleError(new ApiError('x', 404, {}), 'fallback')).toContain(
      'no longer exists'
    );
  });
});
