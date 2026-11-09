import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { getMessages, interpolate } from '../../../shared/i18n';
import { describePriceChangeActionError } from './describe-price-change-error';

describe('describePriceChangeActionError', () => {
  const copy = getMessages('price-changes').describePriceChangeError;

  it('should explain a conflict in operator words', () => {
    expect(describePriceChangeActionError(new ApiError('version mismatch', 409, null))).toBe(copy.conflict);
  });

  it('should show other server text behind a translated prefix, never bare', () => {
    expect(describePriceChangeActionError(new ApiError('Upstream timeout', 500, null))).toBe(
      interpolate(copy.withServerMessage, { message: 'Upstream timeout' })
    );
  });

  it('should fall back to the generic message when there is no server text', () => {
    expect(describePriceChangeActionError('boom')).toBe(copy.fallback);
    expect(describePriceChangeActionError(new Error(''))).toBe(copy.fallback);
  });
});
