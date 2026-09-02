import { describe, expect, it } from 'vitest';
import {
  ReturnDetailUnreadableError,
  parseDeclineReturnResult,
  parseReturnDetail,
} from './return-detail.schema';

const RETURN_ID = 'ol_return_1';

function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RETURN_ID,
    sourceConnectionId: 'conn-1',
    externalReturnId: 'R-77',
    internalOrderId: 'ol_order_9',
    externalOrderId: 'A-123',
    origin: 'source_ingested',
    bucket: 'attributed',
    rawStatus: 'COMMISSION_REFUND_CLAIMED',
    openedAt: '2026-08-01T10:00:00.000Z',
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: '2026-08-01T10:05:00.000Z',
    updatedAt: '2026-08-01T10:05:00.000Z',
    lines: [],
    declineAvailability: { supported: true, reason: null },
    ...overrides,
  };
}

function validLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ol_line_1',
    lineIndex: 0,
    externalLineId: 'L-1',
    resolvedOrderLineId: null,
    offerId: null,
    sku: 'SKU-1',
    name: 'Blue shirt',
    reason: 'withdrawal',
    quantityAdvised: 2,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
    custodyState: 'advised',
    moneyState: 'pending',
    disposition: null,
    receivedAt: null,
    disposedAt: null,
    note: null,
    ...overrides,
  };
}

describe('parseReturnDetail', () => {
  it('should throw ReturnDetailUnreadableError when the envelope cannot be read', () => {
    expect(() => parseReturnDetail({ id: 1 }, RETURN_ID)).toThrow(ReturnDetailUnreadableError);
  });

  it('should accept a missing optional field serialised as null', () => {
    const detail = parseReturnDetail(
      validEnvelope({ externalReturnId: null, rawStatus: null }),
      RETURN_ID,
    );

    expect(detail.externalReturnId).toBeNull();
    expect(detail.rawStatus).toBeNull();
  });

  it('should accept a missing optional field that is absent entirely', () => {
    const envelope = validEnvelope();
    delete envelope.externalOrderId;

    expect(parseReturnDetail(envelope, RETURN_ID).externalOrderId).toBeNull();
  });

  it('should drop a malformed line and count it when the rest are readable', () => {
    const detail = parseReturnDetail(
      validEnvelope({ lines: [validLine(), { id: 'broken' }] }),
      RETURN_ID,
    );

    expect(detail.lines).toHaveLength(1);
    expect(detail.droppedLineCount).toBe(1);
  });

  it('should keep a line whose custody state this build does not recognise', () => {
    const detail = parseReturnDetail(
      validEnvelope({ lines: [validLine({ custodyState: 'quarantined' })] }),
      RETURN_ID,
    );

    expect(detail.droppedLineCount).toBe(0);
    expect(detail.lines[0]?.custodyState).toBe('quarantined');
  });

  it('should preserve the null resolvedOrderLineId rather than dropping the line', () => {
    const detail = parseReturnDetail(validEnvelope({ lines: [validLine()] }), RETURN_ID);

    expect(detail.lines[0]?.resolvedOrderLineId).toBeNull();
  });

  it('should report decline as unsupported with no reason when availability is unreadable', () => {
    const detail = parseReturnDetail(validEnvelope({ declineAvailability: null }), RETURN_ID);

    expect(detail.declineAvailability).toEqual({ supported: false, reason: null });
  });

  it('should preserve a declineAvailability reason verbatim', () => {
    const detail = parseReturnDetail(
      validEnvelope({ declineAvailability: { supported: false, reason: 'no-source-return-id' } }),
      RETURN_ID,
    );

    expect(detail.declineAvailability.reason).toBe('no-source-return-id');
  });

  it('should throw when bucket is a value outside the closed union', () => {
    expect(() => parseReturnDetail(validEnvelope({ bucket: 'partial' }), RETURN_ID)).toThrow(
      ReturnDetailUnreadableError,
    );
  });
});

describe('parseDeclineReturnResult', () => {
  it('should preserve an outcome this build does not recognise', () => {
    const result = parseDeclineReturnResult({
      outcome: 'escalated',
      changeId: null,
      declinedAt: null,
      refusalReason: null,
    });

    expect(result.outcome).toBe('escalated');
  });

  it('should keep declinedAt null for a decline-sent outcome', () => {
    const result = parseDeclineReturnResult({
      outcome: 'decline-sent',
      changeId: 'chg-1',
      declinedAt: null,
      refusalReason: null,
    });

    expect(result.outcome).toBe('decline-sent');
    expect(result.declinedAt).toBeNull();
  });

  it('should return an empty outcome rather than throwing when the body is unreadable', () => {
    expect(parseDeclineReturnResult({ outcome: 42 })).toEqual({
      outcome: '',
      changeId: null,
      declinedAt: null,
      refusalReason: null,
    });
  });
});
