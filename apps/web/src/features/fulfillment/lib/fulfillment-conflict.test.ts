/**
 * 409 discrimination tests (#2411).
 *
 * The contract's whole point is that the two 409s are told apart by `code` and
 * acted on differently. These assert the discrimination, the other 409s
 * (hold limit / already released, read from their own code's copy), and that
 * a non-409 is not silently classified as a conflict.
 */
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../shared/api/api-error';
import { getMessages, interpolate } from '../../../shared/i18n';
import { describeFulfillmentActionError, readFulfillmentConflict } from './fulfillment-conflict';

function conflict(details: unknown): ApiError {
  return new ApiError('boom', 409, details);
}

describe('readFulfillmentConflict (#2411)', () => {
  it('should report a stale token as RETRYABLE', () => {
    const result = readFulfillmentConflict(
      conflict({ code: 'version_conflict', supportedActions: ['hold', 'close'] })
    );

    expect(result?.retryable).toBe(true);
    expect(result?.supportedActions).toEqual(['hold', 'close']);
  });

  it('should report an illegal action as NOT retryable', () => {
    const result = readFulfillmentConflict(
      conflict({ code: 'action_not_legal', action: 'close', supportedActions: ['hold'] })
    );

    expect(result?.retryable).toBe(false);
    expect(result?.supportedActions).toEqual(['hold']);
  });

  it("should read the code's copy for another 409 (hold limit reached)", () => {
    const result = readFulfillmentConflict(
      new ApiError('This fulfilment task already has the maximum number of holds', 409, {
        code: 'FULFILLMENT_HOLD_LIMIT_REACHED',
        params: { limit: 10 },
      })
    );

    expect(result?.retryable).toBe(false);
    expect(result?.message).toBe(
      interpolate(getMessages('errors').codes.FULFILLMENT_HOLD_LIMIT_REACHED, { limit: 10 })
    );
  });

  it('should treat an unrecognised code as NOT retryable', () => {
    expect(readFulfillmentConflict(conflict({ code: 'something_new' }))?.retryable).toBe(false);
  });

  it('should return null for a non-409 so the caller falls through', () => {
    expect(readFulfillmentConflict(new ApiError('nope', 400, {}))).toBeNull();
    expect(readFulfillmentConflict(new ApiError('nope', 500, {}))).toBeNull();
    expect(readFulfillmentConflict(new Error('nope'))).toBeNull();
  });

  it('should tolerate a 409 with no body', () => {
    expect(readFulfillmentConflict(new ApiError('nope', 409, undefined))?.retryable).toBe(false);
  });

  it('should report no refreshed actions when the array is not all strings', () => {
    const result = readFulfillmentConflict(
      conflict({ code: 'version_conflict', supportedActions: ['hold', 7] })
    );

    expect(result?.supportedActions).toBeNull();
  });
});

describe('describeFulfillmentActionError (#2411)', () => {
  it("should read the code's copy for a 400 - it names the missing field or unknown action", () => {
    const message = describeFulfillmentActionError(
      new ApiError("'hold' requires holdReason", 400, { code: 'FULFILLMENT_ACTION_FIELD_MISSING' }),
      'fallback'
    );

    expect(message).toBe(getMessages('errors').codes.FULFILLMENT_ACTION_FIELD_MISSING);
  });

  it('should explain a 403 rather than repeating the generic fallback', () => {
    expect(describeFulfillmentActionError(new ApiError('x', 403, {}), 'fallback')).toContain(
      'permission'
    );
  });

  it('should fall back for an unclassifiable failure', () => {
    expect(describeFulfillmentActionError(new Error('network'), 'fallback')).toBe('fallback');
  });
});
