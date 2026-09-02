/**
 * Authority Resolution Read Model Specs (#2351)
 *
 * One test per acceptance criterion, plus the properties the read model's
 * downstream consumers (#2352–#2357) are told they may rely on.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AuthorityQuestionValues, type AuthorityQuestion } from './authority-question.types';
import {
  AuthorityDefaultWhyCodeValues,
  resolveAuthorities,
  type AuthorityAnswerView,
  type AuthorityClaimantInput,
} from './authority-resolution.types';

/** A claimant that declares everything and claims nothing, for narrowing per test. */
function claimant(overrides: Partial<AuthorityClaimantInput> = {}): AuthorityClaimantInput {
  return {
    connectionId: 'conn-1',
    isActive: true,
    supportedCapabilities: [],
    enabledCapabilities: [],
    config: {},
    ...overrides,
  };
}

function rowFor(rows: readonly AuthorityAnswerView[], question: AuthorityQuestion) {
  const row = rows.find((candidate) => candidate.question === question);
  if (!row) {
    throw new Error(`no row for '${question}'`);
  }
  return row;
}

describe('resolveAuthorities', () => {
  describe('a zero-config install', () => {
    const rows = resolveAuthorities({ claimants: [] });

    it('should answer every one of the seven questions, in table order', () => {
      expect(rows.map((row) => row.question)).toEqual([...AuthorityQuestionValues]);
    });

    it('should give every row a why-line', () => {
      for (const row of rows) {
        if (row.why.kind === 'default') {
          expect(AuthorityDefaultWhyCodeValues).toContain(row.why.code);
        } else {
          expect(typeof row.why.reason).toBe('string');
        }
      }
    });

    it('should give every row a concrete answer — no empty state anywhere (spec §2.3)', () => {
      // Asserted positively, kind by kind: an "is not undefined" check would
      // pass on a shape that renders as nothing.
      expect(rowFor(rows, 'availability').answer).toEqual({ kind: 'openlinker' });
      expect(rowFor(rows, 'sourcing').answer).toEqual({ kind: 'nobody-to-route' });
      expect(rowFor(rows, 'fulfillment-execution').answer).toEqual({ kind: 'default-today' });
      expect(rowFor(rows, 'order-lifecycle').answer).toEqual({ kind: 'openlinker' });
      expect(rowFor(rows, 'returns-disposition').answer).toEqual({ kind: 'manual' });
      expect(rowFor(rows, 'refund-trigger').answer).toEqual({ kind: 'openlinker' });
      expect(rowFor(rows, 'sales-documents').answer).toEqual({
        kind: 'configured-elsewhere',
        surface: 'sales-documents',
      });
    });

    it('should mark the five resolvable rows as default, A6 resolved and A7 unavailable', () => {
      expect(rowFor(rows, 'availability').state).toBe('default');
      expect(rowFor(rows, 'sourcing').state).toBe('default');
      expect(rowFor(rows, 'fulfillment-execution').state).toBe('default');
      expect(rowFor(rows, 'order-lifecycle').state).toBe('default');
      expect(rowFor(rows, 'returns-disposition').state).toBe('default');
      expect(rowFor(rows, 'refund-trigger').state).toBe('resolved');
      expect(rowFor(rows, 'sales-documents').state).toBe('unavailable');
    });
  });

  describe('two claims on one scope', () => {
    const claimants = [
      claimant({
        connectionId: 'conn-a',
        supportedCapabilities: ['AvailabilityAuthority'],
        config: { availabilityAuthority: true },
      }),
      claimant({
        connectionId: 'conn-b',
        supportedCapabilities: ['AvailabilityAuthority'],
        config: { availabilityAuthority: true },
      }),
    ];

    it('should resolve ambiguous and name both candidates', () => {
      const row = rowFor(resolveAuthorities({ claimants }), 'availability');

      expect(row.state).toBe('ambiguous');
      expect(row.answer.kind).toBe('cannot-tell');
      if (row.answer.kind !== 'cannot-tell') {
        throw new Error('unreachable');
      }
      expect([...row.answer.candidateConnectionIds].sort()).toEqual(['conn-a', 'conn-b']);
      expect(row.why).toEqual({ kind: 'ambiguous', reason: row.answer.reason });
    });

    it('should change no behaviour — every other row is identical to the zero-config run', () => {
      const ambiguous = resolveAuthorities({ claimants });
      const baseline = resolveAuthorities({ claimants: [] });

      const others = (rows: readonly AuthorityAnswerView[]) =>
        rows.filter((row) => row.question !== 'availability');

      expect(others(ambiguous)).toEqual(others(baseline));
    });

    it('should not throw', () => {
      expect(() => resolveAuthorities({ claimants })).not.toThrow();
    });
  });

  describe('purity', () => {
    it('should not mutate its input — a deep-frozen argument still resolves', () => {
      const config = Object.freeze({
        availabilityAuthority: Object.freeze({
          enabled: true,
          scopes: Object.freeze([Object.freeze({ kind: 'global' })]),
        }),
      });
      const input = Object.freeze({
        claimants: Object.freeze([
          Object.freeze(
            claimant({ supportedCapabilities: Object.freeze(['AvailabilityAuthority']), config })
          ),
        ]),
      });

      expect(() => resolveAuthorities(input)).not.toThrow();
      expect(rowFor(resolveAuthorities(input), 'availability').state).toBe('resolved');
    });

    it('should be synchronous — the result is not promise-like', () => {
      const result: unknown = resolveAuthorities({ claimants: [] });

      expect(typeof (result as { then?: unknown }).then).toBe('undefined');
    });

    it('should issue no I/O and construct no adapter — the module imports no sibling context', () => {
      // Structural, not behavioural: the leaf carries an EMPTY cross-context
      // allow-set, so anything importable here is a relative sibling in the same
      // leaf. A port call would have to arrive through an import.
      const source = readFileSync(join(__dirname, 'authority-resolution.types.ts'), 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(specifier.startsWith('./')).toBe(true);
      }
      // Comments legitimately say the words ("no I/O, not async"); the CODE
      // must not contain them.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/\basync\b/);
      expect(code).not.toMatch(/\bawait\b/);
    });
  });

  describe('A6 — refund authority is not assignable through any input', () => {
    const claimants = [
      claimant({
        connectionId: 'conn-a',
        supportedCapabilities: ['RefundTrigger'],
        enabledCapabilities: ['RefundTrigger'],
        config: { refundTrigger: true },
      }),
      claimant({
        connectionId: 'conn-b',
        config: { refundTrigger: { enabled: true, isPrimary: true } },
      }),
      claimant({
        connectionId: 'conn-c',
        config: {
          refundTrigger: { enabled: true, scopes: [{ kind: 'order', orderId: 'ol_order_1' }] },
        },
      }),
    ];

    it('should stay OpenLinker, fixed-by-design and resolved whatever any config says', () => {
      const row = rowFor(resolveAuthorities({ claimants }), 'refund-trigger');

      expect(row.answer).toEqual({ kind: 'openlinker' });
      expect(row.source).toBe('fixed-by-design');
      expect(row.state).toBe('resolved');
      expect(row.why).toEqual({ kind: 'default', code: 'a6-only-ol-holds-payment-credentials' });
      expect(row.inactiveClaimantConnectionIds).toEqual([]);
    });

    it('should never be ambiguous — two claimants cannot manufacture a conflict', () => {
      const row = rowFor(resolveAuthorities({ claimants }), 'refund-trigger');

      expect(row.answer.kind).not.toBe('cannot-tell');
      expect(row.state).not.toBe('ambiguous');
    });
  });

  describe('A7 — delegated, never mirrored', () => {
    it('should ignore any config claiming it', () => {
      const rows = resolveAuthorities({
        claimants: [claimant({ config: { salesDocuments: true, salesDocumentAuthority: true } })],
      });

      expect(rowFor(rows, 'sales-documents')).toEqual(
        rowFor(resolveAuthorities({ claimants: [] }), 'sales-documents')
      );
    });
  });

  describe('the availability authority flag', () => {
    it('should resolve a single claimant with no primary flag (the #2047 zero-config rule)', () => {
      const rows = resolveAuthorities({
        claimants: [
          claimant({
            connectionId: 'conn-a',
            supportedCapabilities: ['AvailabilityAuthority'],
            config: { availabilityAuthority: { enabled: true } },
          }),
        ],
      });
      const row = rowFor(rows, 'availability');

      expect(row.state).toBe('resolved');
      expect(row.source).toBe('operator-config');
      expect(row.answer).toEqual({
        kind: 'holders',
        holders: [{ connectionId: 'conn-a', scope: { kind: 'global' } }],
      });
      expect(row.why).toEqual({ kind: 'default', code: 'a1-claimed-by-connection' });
    });

    it('should honour a SCOPED claim rather than reporting the default', () => {
      // The regression D10 exists for: resolving once at `global` discards every
      // narrower claim, and the surface reports "nobody claims this" about a
      // claim that exists.
      const rows = resolveAuthorities({
        claimants: [
          claimant({
            connectionId: 'conn-a',
            supportedCapabilities: ['AvailabilityAuthority'],
            config: {
              availabilityAuthority: {
                enabled: true,
                scopes: [{ kind: 'location', locationId: 'loc-1' }],
              },
            },
          }),
        ],
      });
      const row = rowFor(rows, 'availability');

      expect(row.state).toBe('resolved');
      expect(row.answer).toEqual({
        kind: 'holders',
        holders: [{ connectionId: 'conn-a', scope: { kind: 'location', locationId: 'loc-1' } }],
      });
    });

    it('should fold two disjoint scopes into one routine compound answer', () => {
      const rows = resolveAuthorities({
        claimants: [
          claimant({
            connectionId: 'conn-a',
            supportedCapabilities: ['AvailabilityAuthority'],
            config: {
              availabilityAuthority: {
                enabled: true,
                scopes: [{ kind: 'location', locationId: 'loc-1' }],
              },
            },
          }),
          claimant({
            connectionId: 'conn-b',
            supportedCapabilities: ['AvailabilityAuthority'],
            config: {
              availabilityAuthority: {
                enabled: true,
                scopes: [{ kind: 'location', locationId: 'loc-2' }],
              },
            },
          }),
        ],
      });
      const row = rowFor(rows, 'availability');

      expect(row.state).toBe('resolved');
      expect(row.answer.kind).toBe('holders');
      if (row.answer.kind !== 'holders') {
        throw new Error('unreachable');
      }
      expect(row.answer.holders).toHaveLength(2);
      expect([...row.answer.holders].map((holder) => holder.connectionId).sort()).toEqual([
        'conn-a',
        'conn-b',
      ]);
    });

    it('should not make a claimant eligible when it does not declare the gating capability', () => {
      const rows = resolveAuthorities({
        claimants: [claimant({ config: { availabilityAuthority: true } })],
      });

      expect(rowFor(rows, 'availability').state).toBe('default');
      expect(rowFor(rows, 'availability').inactiveClaimantConnectionIds).toEqual([]);
    });

    it('should accept the capability from either declaration list', () => {
      const enabledOnly = resolveAuthorities({
        claimants: [
          claimant({
            enabledCapabilities: ['AvailabilityAuthority'],
            config: { availabilityAuthority: true },
          }),
        ],
      });

      expect(rowFor(enabledOnly, 'availability').state).toBe('resolved');
    });

    it('should report an inactive claimant without letting it hold or break the row', () => {
      const rows = resolveAuthorities({
        claimants: [
          claimant({
            connectionId: 'conn-off',
            isActive: false,
            supportedCapabilities: ['AvailabilityAuthority'],
            config: { availabilityAuthority: true },
          }),
        ],
      });
      const row = rowFor(rows, 'availability');

      expect(row.state).toBe('default');
      expect(row.answer).toEqual({ kind: 'openlinker' });
      expect(row.inactiveClaimantConnectionIds).toEqual(['conn-off']);
    });
  });

  describe('A5 — returns disposition', () => {
    it('should resolve to the connection the operator enabled ReturnsAuthority on', () => {
      const rows = resolveAuthorities({
        claimants: [
          claimant({
            connectionId: 'conn-returns',
            enabledCapabilities: ['ReturnsAuthority'],
            config: { returnsAuthority: true },
          }),
        ],
      });
      const row = rowFor(rows, 'returns-disposition');

      expect(row.state).toBe('resolved');
      expect(row.answer).toEqual({
        kind: 'holders',
        holders: [{ connectionId: 'conn-returns', scope: { kind: 'global' } }],
      });
    });
  });

  describe('a malformed config', () => {
    it.each([[null], [undefined], [[]], ['availabilityAuthority'], [42]])(
      'should yield the default row rather than throwing (%p)',
      (config) => {
        const rows = resolveAuthorities({
          claimants: [claimant({ supportedCapabilities: ['AvailabilityAuthority'], config })],
        });

        expect(rowFor(rows, 'availability').state).toBe('default');
      }
    );
  });

  describe('state is derived from (source, answer.kind) and nothing else', () => {
    const expected = (row: AuthorityAnswerView) => {
      if (row.answer.kind === 'cannot-tell') return 'ambiguous';
      switch (row.source) {
        case 'delegated':
          return 'unavailable';
        case 'fixed-by-design':
        case 'operator-config':
          return 'resolved';
        case 'default':
          return 'default';
      }
    };

    it.each([
      ['zero-config', [] as AuthorityClaimantInput[]],
      [
        'ambiguous',
        [
          claimant({
            connectionId: 'conn-a',
            supportedCapabilities: ['AvailabilityAuthority'],
            config: { availabilityAuthority: true },
          }),
          claimant({
            connectionId: 'conn-b',
            supportedCapabilities: ['AvailabilityAuthority'],
            config: { availabilityAuthority: true },
          }),
        ],
      ],
    ])('should hold on every row of the %s fixture', (_label, claimants) => {
      for (const row of resolveAuthorities({ claimants })) {
        expect(row.state).toBe(expected(row));
      }
    });
  });
  describe('one connection repeating a scope is ONE claim, not two claimants', () => {
    // `parseAuthorityConfig` reads `scopes` off untrusted jsonb and filters by
    // shape, never by uniqueness, so a duplicated entry is representable. Left
    // undeduped it produced `multiple-claimants-same-scope` with
    // `candidateConnectionIds: ['conn-a','conn-a']` — a row telling the operator
    // two systems are fighting while naming one, and (because the #2353 apply
    // guard is over the RESULT) an install refused by EVERY preset, including
    // the two that cannot remove a duplicate array element.
    it.each([
      ['an implicit global scope repeated', [{ kind: 'global' }, { kind: 'global' }]],
      [
        'two structurally equal channel scopes',
        [
          { kind: 'channel', connectionId: 'chan-x' },
          { kind: 'channel', connectionId: 'chan-x' },
        ],
      ],
    ])('should resolve holders, not cannot-tell, for %s', (_label, scopes) => {
      const row = rowFor(
        resolveAuthorities({
          claimants: [
            claimant({
              connectionId: 'conn-a',
              supportedCapabilities: ['AvailabilityAuthority'],
              config: { availabilityAuthority: { enabled: true, scopes } },
            }),
          ],
        }),
        'availability'
      );

      expect(row.answer.kind).toBe('holders');
      expect(row.state).toBe('resolved');
      if (row.answer.kind === 'holders') {
        expect(row.answer.holders).toHaveLength(1);
        expect(row.answer.holders[0]?.connectionId).toBe('conn-a');
      }
    });

    it('should still report a genuine two-connection conflict as cannot-tell', () => {
      const row = rowFor(
        resolveAuthorities({
          claimants: [
            claimant({
              connectionId: 'conn-a',
              supportedCapabilities: ['AvailabilityAuthority'],
              config: {
                availabilityAuthority: {
                  enabled: true,
                  scopes: [{ kind: 'global' }, { kind: 'global' }],
                },
              },
            }),
            claimant({
              connectionId: 'conn-b',
              supportedCapabilities: ['AvailabilityAuthority'],
              config: { availabilityAuthority: true },
            }),
          ],
        }),
        'availability'
      );

      expect(row.answer.kind).toBe('cannot-tell');
      if (row.answer.kind === 'cannot-tell') {
        expect([...row.answer.candidateConnectionIds].sort()).toEqual(['conn-a', 'conn-b']);
      }
    });
  });
});
