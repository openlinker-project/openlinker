import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { getMessages } from '../../../shared/i18n';
import { describeDeclineError, readBlockedTrigger } from './decline-error';

const codes = (): Record<string, string> => getMessages('errors').codes as Record<string, string>;

describe('readBlockedTrigger', () => {
  it('should read the trigger from the params', () => {
    const error = new ApiError('conflict', 409, {
      code: 'RETURN_NOT_ATTRIBUTED',
      params: { trigger: 'decline' },
      error: 'ReturnNotAttributedError',
      trigger: 'decline',
    });

    expect(readBlockedTrigger(error)).toBe('decline');
  });

  it('should return null when the params carry no trigger', () => {
    expect(readBlockedTrigger(new ApiError('conflict', 409, { code: 'RETURN_NOT_ATTRIBUTED' }))).toBeNull();
  });

  it('should return null for a non-string trigger', () => {
    expect(readBlockedTrigger(new ApiError('conflict', 409, { params: { trigger: 7 } }))).toBeNull();
  });

  it('should return null for anything that is not an ApiError', () => {
    expect(readBlockedTrigger(new Error('boom'))).toBeNull();
  });
});

describe('describeDeclineError', () => {
  it('should read a gone return by its code', () => {
    const error = new ApiError('nope', 404, { code: 'RETURN_NOT_FOUND', params: { returnId: 'r-1' } });

    expect(describeDeclineError(error)).toBe(codes().RETURN_NOT_FOUND);
  });

  it('should read an unmatched return by its code, never quoting the message', () => {
    const message = 'Return ol_return_1 is not attributed to an order - the "decline" trigger';
    const sentence = describeDeclineError(
      new ApiError(message, 409, { code: 'RETURN_NOT_ATTRIBUTED', params: { trigger: 'decline' } })
    );

    expect(sentence).toBe(codes().RETURN_NOT_ATTRIBUTED);
    expect(sentence).not.toContain('ol_return_1');
  });

  it("should follow the translated sentence with the adapter's own explanation", () => {
    const sentence = describeDeclineError(
      new ApiError('Accepted codes: REFUND_REJECTED, DAMAGED', 400, {
        code: 'RETURN_DECLINE_INVALID',
        params: { field: 'reasonCode' },
      })
    );

    expect(sentence).toContain(codes().RETURN_DECLINE_INVALID);
    expect(sentence).toContain('REFUND_REJECTED');
  });

  it('should never be blank, also for a non-ApiError with no message', () => {
    expect(describeDeclineError(new Error('')).length).toBeGreaterThan(0);
  });
});
