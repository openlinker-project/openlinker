/**
 * Preset diff — unit tests.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 */
import { describe, expect, it } from 'vitest';
import { buildPresetDiff } from './preset-diff';
import type { AuthorityAnswerRow, AuthorityPresetChange } from '../api/who-decides.types';

function row(overrides: Partial<AuthorityAnswerRow> = {}): AuthorityAnswerRow {
  return {
    question: 'availability',
    state: 'default',
    source: 'default',
    answer: { kind: 'openlinker' },
    why: { kind: 'default', code: 'a1-computed-from-master-minus-buffer' },
    inactiveClaimantConnectionIds: [],
    ...overrides,
  };
}

const claimed: AuthorityAnswerRow = row({
  state: 'resolved',
  source: 'operator-config',
  answer: { kind: 'holders', parties: [{ connectionId: 'c1', scopeKind: 'global' }] },
  why: { kind: 'default', code: 'a1-claimed-by-connection' },
});

describe('buildPresetDiff', () => {
  it('should produce exactly one line per changed row when given a diff', () => {
    const changes: AuthorityPresetChange[] = [
      { question: 'availability', before: claimed, after: row() },
      {
        question: 'returns-disposition',
        before: row({ question: 'returns-disposition', answer: { kind: 'manual' } }),
        after: row({ question: 'returns-disposition' }),
      },
    ];

    const diff = buildPresetDiff(changes);

    expect(diff.lines).toHaveLength(2);
    expect(diff.lines.map((line) => line.question)).toEqual([
      'availability',
      'returns-disposition',
    ]);
    // The label is the table's own question copy — one wording for one decision.
    expect(diff.lines[0].label).toBe('How much stock can we promise?');
  });

  it('should derive the meaning from the resulting answer when the answer changes', () => {
    const diff = buildPresetDiff([
      { question: 'availability', before: claimed, after: row() },
      {
        question: 'returns-disposition',
        before: row({ question: 'returns-disposition' }),
        after: row({ question: 'returns-disposition', answer: { kind: 'manual' } }),
      },
    ]);

    expect(diff.lines[0].meaning).toBe('OpenLinker will decide this from now on.');
    expect(diff.lines[1].meaning).toBe(
      'Nothing will decide this automatically — you will handle it yourself.',
    );
  });

  it('should render both answers through the table resolver when a row lists systems', () => {
    const diff = buildPresetDiff([{ question: 'availability', before: claimed, after: row() }]);

    expect(diff.lines[0].before).toEqual({ kind: 'parties', connectionIds: ['c1'] });
    expect(diff.lines[0].after).toEqual({ kind: 'text', text: 'OpenLinker' });
  });

  it('should report a preserved assignment when a change switches a claim off', () => {
    // The discriminant stays `holders` even though the view model renames the
    // party LIST to `parties`; testing the wrong one silently reports nothing.
    const diff = buildPresetDiff([{ question: 'availability', before: claimed, after: row() }]);

    expect(diff.preservesAssignment).toBe(true);
  });

  it('should not report a preserved assignment when no claim was switched off', () => {
    const diff = buildPresetDiff([
      {
        question: 'returns-disposition',
        before: row({ question: 'returns-disposition', answer: { kind: 'manual' } }),
        after: row({ question: 'returns-disposition' }),
      },
    ]);

    expect(diff.preservesAssignment).toBe(false);
  });

  it('should return no lines when the preset changes nothing', () => {
    const diff = buildPresetDiff([]);

    expect(diff.lines).toEqual([]);
    expect(diff.preservesAssignment).toBe(false);
  });
});
