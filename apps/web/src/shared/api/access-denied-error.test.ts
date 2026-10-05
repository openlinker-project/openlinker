import { describe, expect, it } from 'vitest';

import { isAccessDeniedError } from './access-denied-error';
import { ANALYTICS_CONSENT_REQUIRED_CODE } from './analytics-consent-error';
import { ApiError } from './api-error';

describe('isAccessDeniedError', () => {
  it('should be true when the API answers a plain 403', () => {
    expect(isAccessDeniedError(new ApiError('Insufficient permissions', 403, null))).toBe(true);
  });

  it('should be false when the 403 is the demo-consent precondition', () => {
    const consent = new ApiError('Consent required', 403, {
      code: ANALYTICS_CONSENT_REQUIRED_CODE,
    });
    expect(isAccessDeniedError(consent)).toBe(false);
  });

  it('should be false when the status is not 403', () => {
    expect(isAccessDeniedError(new ApiError('Not found', 404, null))).toBe(false);
    expect(isAccessDeniedError(new ApiError('Boom', 500, null))).toBe(false);
  });

  it('should be false when the value is not an ApiError', () => {
    expect(isAccessDeniedError(new Error('forbidden'))).toBe(false);
    expect(isAccessDeniedError(null)).toBe(false);
  });
});
