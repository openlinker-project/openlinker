import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { describeDeclineError, readBlockedTrigger } from './decline-error';
import { RETURN_DECLINE_ERROR_COPY } from './return-detail.copy';

describe('readBlockedTrigger', () => {
  it('should read the trigger from the error body', () => {
    const error = new ApiError('conflict', 409, {
      statusCode: 409,
      error: 'ReturnNotAttributedError',
      message: 'Return … is not attributed …',
      trigger: 'decline',
    });

    expect(readBlockedTrigger(error)).toBe('decline');
  });

  it('should return null when the body carries no trigger', () => {
    expect(readBlockedTrigger(new ApiError('conflict', 409, { statusCode: 409 }))).toBeNull();
  });

  it('should return null for a non-string trigger', () => {
    expect(readBlockedTrigger(new ApiError('conflict', 409, { trigger: 7 }))).toBeNull();
  });

  it('should return null for anything that is not an ApiError', () => {
    expect(readBlockedTrigger(new Error('boom'))).toBeNull();
  });
});

describe('describeDeclineError', () => {
  it('should report the return as gone on 404', () => {
    expect(describeDeclineError(new ApiError('nope', 404, {}))).toBe(
      RETURN_DECLINE_ERROR_COPY.notFound,
    );
  });

  it('should name the blocked trigger on 409 rather than quoting the message', () => {
    const message = 'Return ol_return_1 is not attributed to an order — the "decline" trigger…';
    const sentence = describeDeclineError(
      new ApiError(message, 409, { message, trigger: 'decline' }),
    );

    expect(sentence).toContain(RETURN_DECLINE_ERROR_COPY.conflictPrefix);
    expect(sentence).toContain('decline');
    expect(sentence).not.toContain(message);
  });

  it('should fall back to the plain conflict sentence when no trigger is reported', () => {
    expect(describeDeclineError(new ApiError('conflict', 409, {}))).toBe(
      RETURN_DECLINE_ERROR_COPY.conflictPrefix,
    );
  });

  it("should pass through the adapter's own explanation on 400", () => {
    const sentence = describeDeclineError(
      new ApiError('Accepted codes: REFUND_REJECTED, DAMAGED', 400, {}),
    );

    expect(sentence).toContain(RETURN_DECLINE_ERROR_COPY.unsupported);
    expect(sentence).toContain('REFUND_REJECTED');
  });

  it('should fall back to the generic sentence for a non-ApiError with no message', () => {
    expect(describeDeclineError(new Error(''))).toBe(RETURN_DECLINE_ERROR_COPY.generic);
  });
});
