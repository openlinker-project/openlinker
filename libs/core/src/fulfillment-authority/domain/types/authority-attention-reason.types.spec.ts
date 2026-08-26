/**
 * Authority Attention Reason Types — spec (#2352)
 */

import {
  AUTHORITY_ATTENTION_REASON_DESCRIPTORS,
  AuthorityAttentionBadgeValues,
  AuthorityAttentionCountedReasonValues,
  AuthorityAttentionOriginValues,
  AuthorityAttentionProducerValues,
  AuthorityAttentionReasonValues,
  AuthorityAttentionSurfaceValues,
  attentionReasonForAuthorityBlock,
  attentionReasonForAuthorityKind,
  attentionReasonForAuthorityQuestion,
  isAuthorityAttentionProducer,
  isAuthorityAttentionReason,
  readAuthorityAttentionEntries,
  readAuthorityAttentionEntry,
  type AuthorityAttentionReason,
} from './authority-attention-reason.types';
import { AuthorityKindValues, type AuthorityKind } from './authority-kind.types';
import { AuthorityQuestionValues } from './authority-question.types';
import { resolveAuthorities } from './authority-resolution.types';
import type { FulfillmentAuthorityBlock } from './fulfillment-authority-outcome.types';

describe('AuthorityAttentionReasonValues', () => {
  it('should declare exactly the eight spec §4.2 states in table order when read', () => {
    expect(AuthorityAttentionReasonValues).toEqual([
      'availability-unknown',
      'sourcing-ambiguous',
      'fulfillment-unaccepted',
      'line-unfulfillable',
      'reservation-shortfall',
      'returns-disposition-ambiguous',
      'restock-blocked',
      'return-unmatched',
    ]);
  });

  // §4.2 tables NINE rows; AF-X is owned by the automation body and models a
  // per-firing lifecycle no entry here carries. Asserted against an explicit
  // eight so a spec row count can never silently move this union.
  it('should not carry the automation-failure state when read', () => {
    expect(AuthorityAttentionReasonValues).toHaveLength(8);
    expect(AuthorityAttentionReasonValues as readonly string[]).not.toContain('automation-failed');
  });

  // A member is interpolated UNESCAPED into a jsonpath string literal inside a
  // SQL single-quoted literal (`OrderRecordRepository.HAS_OMS_ATTENTION`). There
  // is no injection risk — every value is a compile-time constant — but a future
  // member containing a quote would break the statement at runtime, in a query
  // nothing type-checks. Making the shape structural costs one assertion.
  it.each(AuthorityAttentionReasonValues)(
    'should spell %s in lower-kebab so it is safe to interpolate into a jsonpath literal',
    (reason) => {
      expect(reason).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
  );

  it('should carry no duplicate member when read', () => {
    expect(new Set(AuthorityAttentionReasonValues).size).toBe(
      AuthorityAttentionReasonValues.length
    );
  });
});

describe('AUTHORITY_ATTENTION_REASON_DESCRIPTORS', () => {
  it('should carry one entry per reason, in the same order, when read', () => {
    expect(Object.keys(AUTHORITY_ATTENTION_REASON_DESCRIPTORS)).toEqual([
      ...AuthorityAttentionReasonValues,
    ]);
  });

  it.each(AuthorityAttentionReasonValues)(
    'should describe %s with a closed badge, at least one surface and a declared origin',
    (reason) => {
      const descriptor = AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason];
      expect(AuthorityAttentionBadgeValues).toContain(descriptor.badge);
      expect(AuthorityAttentionOriginValues).toContain(descriptor.origin);
      expect(descriptor.surfaces.length).toBeGreaterThan(0);
      for (const surface of descriptor.surfaces) {
        expect(AuthorityAttentionSurfaceValues).toContain(surface);
      }
      expect(descriptor.specRow).not.toBe('');
    }
  );

  // The derived/persisted partition must be TOTAL: every state is obtained by
  // exactly one mechanism. A member added with a `persisted` origin and no
  // producer would silently have no writer at all.
  it.each(AuthorityAttentionReasonValues)(
    'should name a producer for %s exactly when it is persisted',
    (reason) => {
      const descriptor = AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason];
      if (descriptor.origin === 'persisted') {
        expect(descriptor.producer).not.toBeNull();
        expect(AuthorityAttentionProducerValues).toContain(descriptor.producer);
      } else {
        expect(descriptor.producer).toBeNull();
      }
    }
  );

  it('should give every declared producer at least one state to write when read', () => {
    const used = new Set(
      AuthorityAttentionReasonValues.map(
        (reason) => AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason].producer
      ).filter((producer): producer is NonNullable<typeof producer> => producer !== null)
    );
    expect([...used].sort()).toEqual([...AuthorityAttentionProducerValues].sort());
  });

  it('should map every equivalentAuthorityKind onto a real AuthorityKind, at most once, when read', () => {
    const kinds = AuthorityAttentionReasonValues.map(
      (reason) => AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason].equivalentAuthorityKind
    ).filter((kind): kind is AuthorityKind => kind !== null);
    for (const kind of kinds) {
      expect(AuthorityKindValues).toContain(kind);
    }
    // One kind must not project to two attention states, or
    // `attentionReasonForAuthorityKind` would answer arbitrarily.
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('AuthorityAttentionCountedReasonValues', () => {
  it('should never be empty when read (a consumer builds a SQL literal list from it)', () => {
    expect(AuthorityAttentionCountedReasonValues.length).toBeGreaterThan(0);
  });

  it('should contain exactly the members flagged counted when read', () => {
    expect([...AuthorityAttentionCountedReasonValues]).toEqual(
      AuthorityAttentionReasonValues.filter(
        (reason) => AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason].counted
      )
    );
  });

  // Pinned so a member silently losing `counted` is a failing test rather than a
  // state that disappears from `Needs attention (N)` with nothing to notice it.
  it('should count all eight states today when read', () => {
    expect([...AuthorityAttentionCountedReasonValues]).toEqual([
      ...AuthorityAttentionReasonValues,
    ]);
  });
});

describe('isAuthorityAttentionReason', () => {
  it.each(AuthorityAttentionReasonValues)('should accept %s when narrowed', (reason) => {
    expect(isAuthorityAttentionReason(reason)).toBe(true);
  });

  it.each([
    ['an unknown value from a newer release', 'automation-failed'],
    ['an empty string', ''],
    ['a near miss', 'availability_unknown'],
  ])('should reject %s when narrowed', (_label, value) => {
    expect(isAuthorityAttentionReason(value)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}], [[]]])(
    'should reject the non-string %p when narrowed',
    (value) => {
      expect(isAuthorityAttentionReason(value)).toBe(false);
    }
  );
});

describe('isAuthorityAttentionProducer', () => {
  it.each(AuthorityAttentionProducerValues)('should accept %s when narrowed', (producer) => {
    expect(isAuthorityAttentionProducer(producer)).toBe(true);
  });

  it('should reject a derived pseudo-producer when narrowed', () => {
    expect(isAuthorityAttentionProducer('derived')).toBe(false);
  });
});

describe('readAuthorityAttentionEntry', () => {
  const valid = {
    producer: 'reservations',
    reason: 'reservation-shortfall',
    detail: '2 x SKU-1',
    subjectRef: 'line-7',
    since: '2026-08-26T00:00:00.000Z',
  };

  it('should read a complete entry when every field is recognised', () => {
    expect(readAuthorityAttentionEntry(valid)).toEqual(valid);
  });

  it('should read an entry without its optional fields when they are absent', () => {
    expect(
      readAuthorityAttentionEntry({
        producer: 'routing',
        reason: 'line-unfulfillable',
        since: '2026-08-26T00:00:00.000Z',
      })
    ).toEqual({
      producer: 'routing',
      reason: 'line-unfulfillable',
      since: '2026-08-26T00:00:00.000Z',
    });
  });

  it.each([
    ['an unrecognised reason (a newer release, then rolled back)', { ...valid, reason: 'af-x' }],
    ['an unrecognised producer', { ...valid, producer: 'automations' }],
    ['a missing since', { producer: 'routing', reason: 'line-unfulfillable' }],
    ['a non-object', 'reservation-shortfall'],
    ['an array', []],
    ['null', null],
  ])('should return null for %s when read', (_label, value) => {
    expect(readAuthorityAttentionEntry(value)).toBeNull();
  });

  it('should drop a non-string detail rather than carrying it when read', () => {
    const entry = readAuthorityAttentionEntry({ ...valid, detail: 7 });
    expect(entry).not.toBeNull();
    expect(entry?.detail).toBeUndefined();
  });
});

describe('readAuthorityAttentionEntries', () => {
  it('should drop only the unreadable elements when a column mixes them', () => {
    const good = {
      producer: 'routing',
      reason: 'line-unfulfillable',
      since: '2026-08-26T00:00:00.000Z',
    };
    expect(readAuthorityAttentionEntries([good, { reason: 'af-x' }, null])).toEqual([good]);
  });

  it.each([[null], [undefined], [{}], ['x']])(
    'should read the non-array %p as no entries',
    (value) => {
      expect(readAuthorityAttentionEntries(value)).toEqual([]);
    }
  );
});

describe('attentionReasonForAuthorityKind', () => {
  it.each([
    ['availability', 'availability-unknown'],
    ['sourcing', 'sourcing-ambiguous'],
    ['fulfillment-execution', 'fulfillment-unaccepted'],
    ['returns-disposition', 'returns-disposition-ambiguous'],
  ] as const)('should project %s onto %s when resolved', (kind, expected) => {
    expect(attentionReasonForAuthorityKind(kind)).toBe(expected);
  });

  it.each(['order-lifecycle', 'refund-trigger'] as const)(
    'should project %s onto null when it has no §4.2 state',
    (kind) => {
      expect(attentionReasonForAuthorityKind(kind)).toBeNull();
    }
  );

  it.each(AuthorityKindValues)('should be total over %s when called', (kind) => {
    const projected = attentionReasonForAuthorityKind(kind);
    expect(projected === null || isAuthorityAttentionReason(projected)).toBe(true);
  });
});

describe('attentionReasonForAuthorityBlock', () => {
  const block = (
    overrides: Partial<FulfillmentAuthorityBlock> = {}
  ): FulfillmentAuthorityBlock => ({
    kind: 'availability',
    reason: 'unresolved-authority',
    unresolvedReason: 'ambiguous-no-primary',
    ...overrides,
  });

  it('should project an unresolved availability block onto A1-U when read', () => {
    expect(attentionReasonForAuthorityBlock(block())).toBe('availability-unknown');
  });

  // A block that RESOLVED and was refused is not one of §4.2's inert states —
  // projecting it would put a row in `Needs attention` describing a decision that
  // was in fact taken.
  it.each(['authority-not-delegable', 'no-candidate-accepted', 'subject-state-forbids'] as const)(
    'should project the resolved-but-refused block %s onto null when read',
    (reason) => {
      expect(
        attentionReasonForAuthorityBlock(block({ reason, unresolvedReason: undefined }))
      ).toBeNull();
    }
  );

  it('should project an unresolved refund-trigger block onto null when read', () => {
    expect(attentionReasonForAuthorityBlock(block({ kind: 'refund-trigger' }))).toBeNull();
  });
});

describe('attentionReasonForAuthorityQuestion', () => {
  it.each([
    ['availability', 'availability-unknown'],
    ['sourcing', 'sourcing-ambiguous'],
    ['fulfillment-execution', 'fulfillment-unaccepted'],
    ['returns-disposition', 'returns-disposition-ambiguous'],
  ] as const)('should answer %s with %s when the row is ambiguous', (question, expected) => {
    expect(attentionReasonForAuthorityQuestion(question)).toBe(expected);
  });

  it.each(['order-lifecycle', 'refund-trigger', 'sales-documents'] as const)(
    'should answer %s with null — it never takes the ambiguous value',
    (question) => {
      expect(attentionReasonForAuthorityQuestion(question)).toBeNull();
    }
  );

  it.each(AuthorityQuestionValues)('should be total over %s when called', (question) => {
    const projected = attentionReasonForAuthorityQuestion(question);
    expect(projected === null || isAuthorityAttentionReason(projected)).toBe(true);
  });
});

// A `null`-everywhere implementation satisfies "total over seven questions", so
// the mapping is pinned against `resolveAuthorities`' ACTUAL output for a row it
// really resolves ambiguous.
describe('attentionReasonForAuthorityQuestion, against real resolveAuthorities output', () => {
  const claimant = (connectionId: string) => ({
    connectionId,
    isActive: true,
    supportedCapabilities: ['AvailabilityAuthority'],
    enabledCapabilities: [],
    config: { availabilityAuthority: { enabled: true } },
  });

  it('should name the §4.2 state for every row resolveAuthorities reports ambiguous', () => {
    const views = resolveAuthorities({ claimants: [claimant('c-1'), claimant('c-2')] });
    const ambiguous = views.filter((view) => view.state === 'ambiguous');

    expect(ambiguous.length).toBeGreaterThan(0);
    for (const view of ambiguous) {
      const reason = attentionReasonForAuthorityQuestion(view.question);
      expect(reason).not.toBeNull();
      expect(AuthorityAttentionCountedReasonValues).toContain(reason as AuthorityAttentionReason);
    }
  });

  it('should name no state for a zero-config install, so the count stays zero', () => {
    const views = resolveAuthorities({ claimants: [] });
    expect(views.filter((view) => view.state === 'ambiguous')).toHaveLength(0);
  });
});
