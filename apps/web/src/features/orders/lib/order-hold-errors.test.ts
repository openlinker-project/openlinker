import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { getMessages } from '../../../shared/i18n';
import { describeHoldWriteError, holdWriteErrorNeedsRefresh } from './order-hold-errors';

const codes = (): Record<string, string> => getMessages('errors').codes as Record<string, string>;

describe('order hold errors (#3863)', () => {
  it('should read both conflicts by their code and ask for a refresh', () => {
    for (const code of ['ORDER_ALREADY_ON_HOLD', 'HOLD_ALREADY_RELEASED']) {
      const error = new ApiError('english', 409, { code });

      expect(describeHoldWriteError(error)).toBe(codes()[code]);
      expect(holdWriteErrorNeedsRefresh(error)).toBe(true);
    }
  });

  it('should still read the code a body sent only in error', () => {
    expect(holdWriteErrorNeedsRefresh(new ApiError('x', 409, { error: 'ORDER_ALREADY_ON_HOLD' }))).toBe(true);
  });

  it('should not ask for a refresh for another error', () => {
    expect(holdWriteErrorNeedsRefresh(new ApiError('x', 409, { code: 'ORDER_HOLD_CONTENDED' }))).toBe(false);
    expect(holdWriteErrorNeedsRefresh(new Error('x'))).toBe(false);
    expect(describeHoldWriteError(new Error('')).length).toBeGreaterThan(0);
  });
});
