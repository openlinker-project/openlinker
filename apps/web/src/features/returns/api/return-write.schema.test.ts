import { describe, expect, it } from 'vitest';
import {
  ReturnWriteResultUnreadableError,
  parseAuthorizeReturnResult,
  parseMatchReturnToOrderResult,
  parseRecordReturnResult,
} from './return-write.schema';

describe('parseAuthorizeReturnResult', () => {
  it('should round-trip a well-formed body', () => {
    const result = parseAuthorizeReturnResult({
      outcome: 'authorized',
      changeId: 'ol_change_1',
      authorizedAt: '2026-08-01T10:00:00.000Z',
    });

    expect(result).toEqual({
      outcome: 'authorized',
      changeId: 'ol_change_1',
      authorizedAt: '2026-08-01T10:00:00.000Z',
    });
  });

  it('should read an omitted nullish field as null, never undefined', () => {
    const result = parseAuthorizeReturnResult({ outcome: 'already-authorized' });

    expect(result.changeId).toBeNull();
    expect(result.authorizedAt).toBeNull();
  });

  it('should read an explicit null the same as an omitted field', () => {
    const result = parseAuthorizeReturnResult({
      outcome: 'already-authorized',
      changeId: null,
      authorizedAt: null,
    });

    expect(result.changeId).toBeNull();
    expect(result.authorizedAt).toBeNull();
  });

  it('should throw ReturnWriteResultUnreadableError on a malformed body', () => {
    expect(() => parseAuthorizeReturnResult({ changeId: 'ol_change_1' })).toThrow(
      ReturnWriteResultUnreadableError,
    );
  });
});

describe('parseMatchReturnToOrderResult', () => {
  it('should round-trip a well-formed body', () => {
    const result = parseMatchReturnToOrderResult({
      returnId: 'ol_return_1',
      internalOrderId: 'ol_order_9',
      matchedAt: '2026-08-01T10:00:00.000Z',
    });

    expect(result).toEqual({
      returnId: 'ol_return_1',
      internalOrderId: 'ol_order_9',
      matchedAt: '2026-08-01T10:00:00.000Z',
    });
  });

  it('should read an omitted nullish field as null, never undefined', () => {
    const result = parseMatchReturnToOrderResult({ returnId: 'ol_return_1' });

    expect(result.internalOrderId).toBeNull();
    expect(result.matchedAt).toBeNull();
  });

  it('should throw ReturnWriteResultUnreadableError on a malformed body', () => {
    expect(() => parseMatchReturnToOrderResult({ internalOrderId: 'ol_order_9' })).toThrow(
      ReturnWriteResultUnreadableError,
    );
  });
});

describe('parseRecordReturnResult', () => {
  it('should round-trip a well-formed body', () => {
    const result = parseRecordReturnResult({
      returnId: 'ol_return_1',
      internalOrderId: 'ol_order_9',
      origin: 'operator_authored',
      openedAt: '2026-08-01T10:00:00.000Z',
    });

    expect(result).toEqual({
      returnId: 'ol_return_1',
      internalOrderId: 'ol_order_9',
      origin: 'operator_authored',
      openedAt: '2026-08-01T10:00:00.000Z',
    });
  });

  it('should read an omitted internalOrderId as null, never undefined', () => {
    const result = parseRecordReturnResult({
      returnId: 'ol_return_1',
      origin: 'operator_authored',
      openedAt: '2026-08-01T10:00:00.000Z',
    });

    expect(result.internalOrderId).toBeNull();
  });

  it('should throw ReturnWriteResultUnreadableError on a malformed body', () => {
    expect(() =>
      parseRecordReturnResult({ returnId: 'ol_return_1', origin: 'operator_authored' }),
    ).toThrow(ReturnWriteResultUnreadableError);
  });
});
