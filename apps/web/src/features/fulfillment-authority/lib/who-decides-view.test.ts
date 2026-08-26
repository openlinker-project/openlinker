/**
 * Who-decides row view model — unit tests.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 */
import { describe, expect, it } from 'vitest';
import {
  resolveAnswer,
  resolveCandidateConnectionIds,
  resolveRowBadge,
  resolveWhyLine,
  rowBadgeTone,
} from './who-decides-view';
import { ATTENTION_REASON_COPY, ATTENTION_UNKNOWN_COPY } from './attention-reason.copy';
import { WHY_CODE_COPY } from './who-decides.copy';
import type {
  AuthorityAnswer,
  AuthorityAnswerRow,
  AuthorityAttention,
  AuthorityQuestion,
  AuthoritySource,
  AuthorityState,
  AuthorityWhy,
} from '../api/who-decides.types';

const EMPTY_ATTENTION: AuthorityAttention = { counted: [], routine: [], affectedOrderCount: 0 };

function row(overrides: {
  question?: AuthorityQuestion;
  state?: AuthorityState;
  source?: AuthoritySource;
  answer?: AuthorityAnswer;
  why?: AuthorityWhy;
  inactive?: readonly string[];
}): AuthorityAnswerRow {
  return {
    question: overrides.question ?? 'availability',
    state: overrides.state ?? 'default',
    source: overrides.source ?? 'default',
    answer: overrides.answer ?? { kind: 'openlinker' },
    why: overrides.why ?? { kind: 'default', code: 'a1-computed-from-master-minus-buffer' },
    inactiveClaimantConnectionIds: overrides.inactive ?? [],
  };
}

describe('resolveRowBadge', () => {
  it('should render Always when the source is fixed by design, whatever the question', () => {
    // A6 is identified by `source`, never by a question literal — the rule
    // lives in core and a browser-side question test would be a second copy.
    expect(resolveRowBadge(row({ source: 'fixed-by-design', state: 'resolved' }))).toBe('always');
    expect(
      resolveRowBadge(row({ question: 'refund-trigger', source: 'fixed-by-design', state: 'resolved' })),
    ).toBe('always');
  });

  it('should render Elsewhere when the answer is delegated', () => {
    expect(
      resolveRowBadge(
        row({
          question: 'sales-documents',
          source: 'delegated',
          state: 'unavailable',
          answer: { kind: 'configured-elsewhere', surface: 'sales-documents' },
        }),
      ),
    ).toBe('elsewhere');
  });

  it('should render Nothing is deciding when the row is ambiguous', () => {
    expect(
      resolveRowBadge(
        row({
          state: 'ambiguous',
          source: 'operator-config',
          answer: {
            kind: 'cannot-tell',
            reason: 'multiple-claimants-same-scope',
            candidateConnectionIds: ['c1', 'c2'],
          },
          why: { kind: 'ambiguous', reason: 'multiple-claimants-same-scope' },
        }),
      ),
    ).toBe('nothing-is-deciding');
  });

  it('should distinguish Nothing to route from a plain Default', () => {
    expect(resolveRowBadge(row({ state: 'default', answer: { kind: 'nobody-to-route' } }))).toBe(
      'nothing-to-route',
    );
    expect(resolveRowBadge(row({ state: 'default', answer: { kind: 'openlinker' } }))).toBe('default');
  });

  it('should render Chosen when an operator picked somebody', () => {
    expect(
      resolveRowBadge(
        row({
          state: 'resolved',
          source: 'operator-config',
          answer: { kind: 'holders', parties: [{ connectionId: 'c1', scopeKind: 'global' }] },
        }),
      ),
    ).toBe('chosen');
  });

  it('should render Not available rather than Chosen for an unavailable row that is not delegated', () => {
    // Unreachable today: `deriveAuthorityState` only reaches `unavailable` via
    // `delegated`. That invariant lives in `libs/core`, which the browser can
    // neither import (#591) nor observe — so a fall-through arm would render
    // `Chosen` on a row where nothing is decided the day core changes.
    expect(resolveRowBadge(row({ state: 'unavailable', source: 'operator-config' }))).toBe(
      'not-available',
    );
  });
});

describe('rowBadgeTone', () => {
  it('should make Nothing is deciding the only red badge', () => {
    expect(rowBadgeTone('nothing-is-deciding')).toBe('error');
    for (const badge of ['default', 'nothing-to-route', 'always', 'elsewhere', 'chosen', 'not-available'] as const) {
      expect(rowBadgeTone(badge)).not.toBe('error');
    }
  });
});

describe('resolveAnswer', () => {
  it('should render A7 as a link and never as mirrored text', () => {
    expect(
      resolveAnswer(
        row({ answer: { kind: 'configured-elsewhere', surface: 'sales-documents' } }),
      ),
    ).toEqual({ kind: 'link' });
  });

  it('should return every party id for a compound answer', () => {
    expect(
      resolveAnswer(
        row({
          answer: {
            kind: 'holders',
            parties: [
              { connectionId: 'shop', scopeKind: 'global' },
              { connectionId: 'allegro', scopeKind: 'channel' },
            ],
          },
        }),
      ),
    ).toEqual({ kind: 'parties', connectionIds: ['shop', 'allegro'] });
  });

  it('should render a sentence for every non-party answer shape', () => {
    for (const kind of ['openlinker', 'manual', 'default-today', 'nobody-to-route'] as const) {
      const rendering = resolveAnswer(row({ answer: { kind } }));
      expect(rendering.kind).toBe('text');
      if (rendering.kind === 'text') {
        expect(rendering.text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('resolveWhyLine', () => {
  it('should render the default why-line from its code', () => {
    expect(
      resolveWhyLine(
        row({ why: { kind: 'default', code: 'a2-single-origin-nothing-to-choose' } }),
        EMPTY_ATTENTION,
      ),
    ).toBe(WHY_CODE_COPY['a2-single-origin-nothing-to-choose']);
  });

  it('should REPLACE the why-line with the matching inert-state body when the row is ambiguous', () => {
    const attention: AuthorityAttention = {
      counted: [
        {
          reason: 'availability-unknown',
          badge: 'stopped',
          surfaces: ['product'],
          origin: 'authority-resolution',
          question: 'availability',
          connectionIds: ['c1', 'c2'],
        },
      ],
      routine: [],
      affectedOrderCount: 0,
    };

    expect(
      resolveWhyLine(
        row({
          question: 'availability',
          why: { kind: 'ambiguous', reason: 'multiple-claimants-same-scope' },
        }),
        attention,
      ),
    ).toBe(ATTENTION_REASON_COPY['availability-unknown'].body);
  });

  it('should fall back to the shared unknown copy when no attention item names the row', () => {
    expect(
      resolveWhyLine(
        row({ why: { kind: 'ambiguous', reason: 'no-primary' } }),
        EMPTY_ATTENTION,
      ),
    ).toBe(ATTENTION_UNKNOWN_COPY.body);
  });

  it('should fall back to the shared unknown copy for a reason this build cannot name', () => {
    const attention: AuthorityAttention = {
      counted: [
        {
          reason: 'a-reason-from-a-newer-release',
          badge: 'stopped',
          surfaces: [],
          origin: 'authority-resolution',
          question: 'availability',
          connectionIds: [],
        },
      ],
      routine: [],
      affectedOrderCount: 0,
    };

    expect(
      resolveWhyLine(
        row({ question: 'availability', why: { kind: 'ambiguous', reason: 'no-primary' } }),
        attention,
      ),
    ).toBe(ATTENTION_UNKNOWN_COPY.body);
  });
});

describe('resolveCandidateConnectionIds', () => {
  it('should name both connections on an ambiguous row and none otherwise', () => {
    expect(
      resolveCandidateConnectionIds(
        row({
          answer: {
            kind: 'cannot-tell',
            reason: 'multiple-primaries',
            candidateConnectionIds: ['c1', 'c2'],
          },
        }),
      ),
    ).toEqual(['c1', 'c2']);
    expect(resolveCandidateConnectionIds(row({}))).toEqual([]);
  });
});
