/**
 * Authority status schema — unit tests.
 *
 * @module apps/web/src/features/fulfillment-authority/api
 */
import { describe, expect, it } from 'vitest';
import { parseAuthorityPresetPreview, parseAuthorityStatus } from './who-decides.schema';

/** A minimal but complete zero-config payload: all seven rows, no config. */
function zeroConfigPayload(): unknown {
  return {
    rows: [
      {
        question: 'availability',
        state: 'default',
        source: 'default',
        answer: { kind: 'openlinker' },
        why: { kind: 'default', code: 'a1-computed-from-master-minus-buffer' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'sourcing',
        state: 'default',
        source: 'default',
        answer: { kind: 'nobody-to-route' },
        why: { kind: 'default', code: 'a2-single-origin-nothing-to-choose' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'fulfillment-execution',
        state: 'default',
        source: 'default',
        answer: { kind: 'default-today' },
        why: { kind: 'default', code: 'a3-lands-where-it-does-today' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'order-lifecycle',
        state: 'default',
        source: 'default',
        answer: { kind: 'openlinker' },
        why: { kind: 'default', code: 'a4-derived-from-observed-facts' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'returns-disposition',
        state: 'default',
        source: 'default',
        answer: { kind: 'manual' },
        why: { kind: 'default', code: 'a5-nothing-decides-yet-handled-by-hand' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'refund-trigger',
        state: 'resolved',
        source: 'fixed-by-design',
        answer: { kind: 'openlinker' },
        why: { kind: 'default', code: 'a6-only-ol-holds-payment-credentials' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'sales-documents',
        state: 'unavailable',
        source: 'delegated',
        answer: { kind: 'configured-elsewhere', surface: 'sales-documents' },
        why: { kind: 'default', code: 'a7-configured-under-sales-documents' },
        inactiveClaimantConnectionIds: [],
      },
    ],
    attention: { counted: [], routine: [], affectedOrderCount: 0 },
    presets: [
      { id: 'leave-as-they-are', available: true, unavailableReason: null },
      { id: 'openlinker-decides', available: true, unavailableReason: null },
      {
        id: 'keep-other-system',
        available: false,
        unavailableReason: 'needs-a-system-that-can-take-over',
      },
    ],
    applied: null,
  };
}

describe('parseAuthorityStatus', () => {
  it('should parse a zero-config payload into seven rows', () => {
    const parsed = parseAuthorityStatus(zeroConfigPayload());
    expect(parsed).not.toBeNull();
    expect(parsed?.rows).toHaveLength(7);
  });

  it('should accept JSON null for an absent optional, not just an omitted key (#939)', () => {
    // OL serialises an absent optional as `null`; a bare `.optional()` rejects
    // it, which is what once dropped a whole section from one empty field.
    const payload = zeroConfigPayload() as Record<string, unknown>;
    payload.applied = null;
    const rows = payload.rows as Record<string, unknown>[];
    rows[0].inactiveClaimantConnectionIds = null;

    const parsed = parseAuthorityStatus(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.applied).toBeNull();
    expect(parsed?.rows[0].inactiveClaimantConnectionIds).toEqual([]);
  });

  it('should keep the unavailable preset and its reason code', () => {
    const parsed = parseAuthorityStatus(zeroConfigPayload());
    const preset = parsed?.presets.find((p) => p.id === 'keep-other-system');
    expect(preset?.available).toBe(false);
    expect(preset?.unavailableReason).toBe('needs-a-system-that-can-take-over');
  });

  it('should rename the wire `holders` list to parties and default a missing scope', () => {
    const payload = zeroConfigPayload() as Record<string, unknown>;
    const rows = payload.rows as Record<string, unknown>[];
    rows[0].state = 'resolved';
    rows[0].source = 'operator-config';
    rows[0].answer = { kind: 'holders', holders: [{ connectionId: 'c1' }] };
    rows[0].why = { kind: 'default', code: 'a1-claimed-by-connection' };

    const parsed = parseAuthorityStatus(payload);
    const answer = parsed?.rows[0].answer;
    expect(answer?.kind).toBe('holders');
    if (answer?.kind === 'holders') {
      expect(answer.parties).toEqual([{ connectionId: 'c1', scopeKind: 'global' }]);
    }
  });

  it('should carry the apply report so a partial result is distinguishable', () => {
    const payload = zeroConfigPayload() as Record<string, unknown>;
    payload.applied = { updatedConnectionIds: ['c1'], failedConnectionIds: ['c2'] };

    const parsed = parseAuthorityStatus(payload);
    expect(parsed?.applied?.failedConnectionIds).toEqual(['c2']);
  });

  it('should report an unreadable envelope as null rather than an empty table', () => {
    // An empty table on this page would assert that the operator has no
    // decisions to see, which § 2.3 says is never true.
    expect(parseAuthorityStatus({ rows: 'not-an-array' })).toBeNull();
    expect(parseAuthorityStatus(null)).toBeNull();
    expect(parseAuthorityStatus(undefined)).toBeNull();
  });

  it('should refuse a row whose state this build does not understand', () => {
    const payload = zeroConfigPayload() as Record<string, unknown>;
    const rows = payload.rows as Record<string, unknown>[];
    rows[0].state = 'a-state-from-a-newer-release';
    expect(parseAuthorityStatus(payload)).toBeNull();
  });
});

describe('parseAuthorityPresetPreview', () => {
  function wireRow(): unknown {
    return {
      question: 'availability',
      state: 'resolved',
      source: 'operator-config',
      answer: { kind: 'holders', holders: [{ connectionId: 'c1', scope: { kind: 'global' } }] },
      why: { kind: 'default', code: 'a1-claimed-by-connection' },
      inactiveClaimantConnectionIds: [],
    };
  }

  it('should map both sides of a change through the same row mapper when the payload is readable', () => {
    const parsed = parseAuthorityPresetPreview({
      presetId: 'openlinker-decides',
      changes: [
        {
          question: 'availability',
          before: wireRow(),
          after: {
            question: 'availability',
            state: 'default',
            source: 'default',
            answer: { kind: 'openlinker' },
            why: { kind: 'default', code: 'a1-computed-from-master-minus-buffer' },
            inactiveClaimantConnectionIds: [],
          },
        },
      ],
      resultingAmbiguities: [],
      blocked: false,
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.changes).toHaveLength(1);
    // The wire calls the list `holders`; the view model calls it `parties`,
    // while the discriminant stays `holders` on both sides.
    expect(parsed?.changes[0].before.answer).toEqual({
      kind: 'holders',
      parties: [{ connectionId: 'c1', scopeKind: 'global' }],
    });
    expect(parsed?.blocked).toBe(false);
  });

  it('should carry the ambiguity connection ids when the result would be blocked', () => {
    const parsed = parseAuthorityPresetPreview({
      presetId: 'leave-as-they-are',
      changes: [],
      resultingAmbiguities: [
        {
          reason: 'availability-unknown',
          badge: 'stopped',
          surfaces: ['product'],
          origin: 'authority-resolution',
          question: 'availability',
          connectionIds: ['c1', 'c2'],
        },
      ],
      blocked: true,
    });

    expect(parsed?.blocked).toBe(true);
    expect(parsed?.resultingAmbiguities[0].connectionIds).toEqual(['c1', 'c2']);
  });

  it('should tolerate a null optional field rather than dropping the envelope', () => {
    const parsed = parseAuthorityPresetPreview({
      presetId: 'openlinker-decides',
      changes: [],
      resultingAmbiguities: [
        {
          reason: 'availability-unknown',
          badge: 'stopped',
          surfaces: null,
          origin: 'authority-resolution',
          question: null,
          connectionIds: null,
        },
      ],
      blocked: true,
    });

    expect(parsed?.resultingAmbiguities[0]).toMatchObject({
      surfaces: [],
      question: null,
      connectionIds: [],
    });
  });

  it('should return null when the envelope cannot be read', () => {
    expect(parseAuthorityPresetPreview({ presetId: 'not-a-preset', changes: [] })).toBeNull();
    expect(parseAuthorityPresetPreview(null)).toBeNull();
  });
});
