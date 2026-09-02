import { describe, expect, it } from 'vitest';
import { ReturnTimelineUnreadableError, parseReturnTimeline } from './return-timeline.schema';

const entry = {
  id: 'ev1',
  source: 'custody_act',
  kind: 'receive',
  occurredAt: '2026-08-20T10:00:00.000Z',
  returnId: 'ol_return_1',
  returnOrigin: 'source_ingested',
};

describe('parseReturnTimeline', () => {
  it('parses an entry whose optional fields are absent', () => {
    const [parsed] = parseReturnTimeline({ entries: [entry] });

    expect(parsed.externalReturnId).toBeNull();
    expect(parsed.sourceConnectionName).toBeNull();
    expect(parsed.quantity).toBeNull();
  });

  it('normalises an explicit null the same as an absent field', () => {
    // The backend serialises absent optionals as JSON `null`, so `.nullish()`
    // is required — `.optional()` would drop the whole entry.
    const [parsed] = parseReturnTimeline({
      entries: [{ ...entry, sourceConnectionName: null, quantity: null }],
    });

    expect(parsed.sourceConnectionName).toBeNull();
    expect(parsed.quantity).toBeNull();
  });

  it('keeps a kind this build does not recognise', () => {
    const [parsed] = parseReturnTimeline({ entries: [{ ...entry, kind: 'teleported' }] });

    expect(parsed.kind).toBe('teleported');
  });

  it('throws a NAMED error on a contract break rather than yielding undefined', () => {
    expect(() => parseReturnTimeline({ entries: [{ ...entry, occurredAt: undefined }] })).toThrow(
      ReturnTimelineUnreadableError
    );
    expect(() => parseReturnTimeline({ nope: true })).toThrow(ReturnTimelineUnreadableError);
  });

  it('parses an empty list', () => {
    expect(parseReturnTimeline({ entries: [] })).toEqual([]);
  });
});
