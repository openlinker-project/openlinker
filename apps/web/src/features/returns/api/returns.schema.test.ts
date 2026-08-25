import { describe, it, expect } from 'vitest';
import { parseReturnIngestionAvailability, parseReturnList } from './returns.schema';

function rawItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ol_return_1',
    sourceConnectionId: 'conn_1',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_1',
    externalOrderId: 'ORD-1',
    origin: 'source_ingested',
    bucket: 'attributed',
    rawStatus: 'COMMISSION_REFUND_CLAIMED',
    openedAt: '2026-01-01T00:00:00.000Z',
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rawEnvelope(items: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    counts: { total: items.length, orphan: 0, attributed: items.length },
    ...overrides,
  };
}

describe('parseReturnList', () => {
  it('should parse a well-formed row', () => {
    const result = parseReturnList(rawEnvelope([rawItem()]));

    expect(result.droppedCount).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].externalReturnId).toBe('RET-1');
    expect(result.items[0].rawStatus).toBe('COMMISSION_REFUND_CLAIMED');
  });

  // The #939 rule: OpenLinker serialises an absent optional as JSON `null`, so
  // `.optional()` would reject it and drop the whole row.
  it.each([
    'externalReturnId',
    'internalOrderId',
    'externalOrderId',
    'rawStatus',
    'openedAt',
    'authorizedAt',
    'declinedAt',
    'closedAt',
  ])('should accept a null %s rather than dropping the row', (field) => {
    const result = parseReturnList(rawEnvelope([rawItem({ [field]: null })]));

    expect(result.droppedCount).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0][field as 'rawStatus']).toBeNull();
  });

  it('should normalise an omitted optional field to null', () => {
    const item = rawItem();
    delete item.rawStatus;

    const result = parseReturnList(rawEnvelope([item]));

    expect(result.items).toHaveLength(1);
    expect(result.items[0].rawStatus).toBeNull();
  });

  it('should drop only the malformed row and keep the rest', () => {
    // Non-fatal per row: one bad row must not blank a page of good ones.
    const result = parseReturnList(
      rawEnvelope([rawItem({ id: 'ok_1' }), { id: 'broken' }, rawItem({ id: 'ok_2' })]),
    );

    expect(result.items.map((item) => item.id)).toEqual(['ok_1', 'ok_2']);
    expect(result.droppedCount).toBe(1);
  });

  it('should drop a row whose bucket is outside the closed union', () => {
    const result = parseReturnList(rawEnvelope([rawItem({ bucket: 'declined' })]));

    expect(result.items).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  it('should keep the server totals untouched when a row drops', () => {
    // The range label counts what the server says exists; the rendered rows
    // count what could be shown. Silently shrinking the total would hide the gap.
    const result = parseReturnList(
      rawEnvelope([rawItem(), { id: 'broken' }], {
        total: 47,
        counts: { total: 47, orphan: 3, attributed: 44 },
      }),
    );

    expect(result.total).toBe(47);
    expect(result.counts).toEqual({ total: 47, orphan: 3, attributed: 44 });
    expect(result.droppedCount).toBe(1);
  });

  it('should not throw on an unreadable envelope', () => {
    const result = parseReturnList('not an envelope');

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.counts).toBeNull();
  });

  it('should report null counts — never a synthesised partition — when counts are unreadable', () => {
    // Defaulting to `{ total: items.length, orphan: 0, attributed: items.length }`
    // would claim every row on the page is matched to an order AND that the
    // page is the whole scope, both invented, both rendered onto the chips as
    // authoritative numbers.
    const result = parseReturnList(rawEnvelope([rawItem()], { counts: null }));

    expect(result.counts).toBeNull();
    expect(result.items).toHaveLength(1);
  });

  it('should report the paging the server actually applied', () => {
    const result = parseReturnList(rawEnvelope([rawItem()], { limit: 20, offset: 40 }));

    expect(result.limit).toBe(20);
    expect(result.offset).toBe(40);
  });

  it('should report null paging when the server did not echo it', () => {
    const result = parseReturnList(rawEnvelope([rawItem()], { limit: null, offset: null }));

    expect(result.limit).toBeNull();
    expect(result.offset).toBeNull();
  });

  it('should tolerate a null items array', () => {
    expect(parseReturnList(rawEnvelope([], { items: null })).items).toEqual([]);
  });
});

describe('parseReturnIngestionAvailability', () => {
  it('should parse the configured fact', () => {
    expect(
      parseReturnIngestionAvailability({ configured: true, connectionIds: ['conn_1'] }),
    ).toEqual({ configured: true, connectionIds: ['conn_1'] });
  });

  it('should parse configured: false', () => {
    expect(parseReturnIngestionAvailability({ configured: false, connectionIds: [] })).toEqual({
      configured: false,
      connectionIds: [],
    });
  });

  it('should tolerate a null connectionIds', () => {
    expect(parseReturnIngestionAvailability({ configured: true, connectionIds: null })).toEqual({
      configured: true,
      connectionIds: [],
    });
  });

  it('should return null — never configured: false — for an unreadable response', () => {
    // `configured: false` is a positive claim about the operator's setup, and a
    // parse failure is not evidence for it.
    expect(parseReturnIngestionAvailability({ nonsense: true })).toBeNull();
    expect(parseReturnIngestionAvailability(null)).toBeNull();
  });
});
