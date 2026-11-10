import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { getMessages } from '../../../shared/i18n';
import { describePriceChangeActionError } from './describe-price-change-error';

describe('describePriceChangeActionError', () => {
  const copy = getMessages('price-changes');

  it('should explain a stale episode in operator words', () => {
    expect(
      describePriceChangeActionError(new ApiError('version mismatch', 409, { code: 'PRICE_CHANGE_STALE' }))
    ).toBe(copy.apiErrors.PRICE_CHANGE_STALE);
  });

  it('should name the currency settings when a block is a currency mismatch', () => {
    const error = new ApiError('blocked', 422, {
      code: 'PRICE_CHANGE_BLOCKED',
      params: { blockReason: 'currency-mismatch' },
    });
    expect(describePriceChangeActionError(error)).toBe(copy.describePriceChangeError.currencyMismatch);
  });

  it('should read any other block through the feature copy', () => {
    const error = new ApiError('blocked', 422, {
      code: 'PRICE_CHANGE_BLOCKED',
      params: { blockReason: 'no-price' },
    });
    expect(describePriceChangeActionError(error)).toBe(copy.apiErrors.PRICE_CHANGE_BLOCKED);
  });

  it('should fall back to the status copy for an uncoded server error', () => {
    expect(describePriceChangeActionError(new ApiError('Upstream timeout', 500, null))).toBe(
      getMessages('errors').status['5xx']
    );
  });

  it('should never be blank for a non-API error', () => {
    expect(describePriceChangeActionError('boom')).toBe(getMessages('errors').status.other);
  });
});
