/**
 * ApiError tests: status helpers (#1625 — isConflict()) and the factory
 * fallbacks, whose operator copy must not carry the request path (#3868).
 */
import { describe, expect, it } from 'vitest';
import { getMessages } from '../i18n';
import { ApiError } from './api-error';

describe('ApiError', () => {
  describe('isConflict', () => {
    it('returns true for a 409 status', () => {
      expect(new ApiError('Email already registered', 409, null).isConflict()).toBe(true);
    });

    it('returns false for a non-409 status', () => {
      expect(new ApiError('Not found', 404, null).isConflict()).toBe(false);
    });
  });

  describe('fromTimeout', () => {
    it('should keep the request path in details when the message is operator copy', () => {
      const error = ApiError.fromTimeout('/v1/orders?page=2');

      expect(error.status).toBe(0);
      expect(error.message).toBe(getMessages('ui').apiError.timedOut);
      expect(error.message).not.toContain('/v1/orders');
      expect(error.details).toEqual({ timeout: true, path: '/v1/orders?page=2' });
    });
  });

  describe('fromNetworkFailure', () => {
    it('should use the fallback copy when the cause is not an Error', () => {
      const error = ApiError.fromNetworkFailure('offline');

      expect(error.status).toBe(0);
      expect(error.message).toBe(getMessages('ui').apiError.networkFailed);
      expect(error.details).toBe('offline');
    });
  });

  describe('the coded envelope (#3862)', () => {
    it('reads the code, the scalar params, the fields and the provider words from the body', () => {
      const error = new ApiError('english', 400, {
        code: 'PROVIDER_REJECTED',
        params: { provider: 'shop', count: 2, ok: true, nested: { a: 1 } },
        fields: [{ path: 'items.0.quantity', code: 'min', params: { min: 1 } }, { path: 1 }],
        providerMessage: 'Refused by the shop',
      });

      expect(error.code).toBe('PROVIDER_REJECTED');
      expect(error.params).toEqual({ provider: 'shop', count: 2, ok: true });
      expect(error.fields).toEqual([{ path: 'items.0.quantity', code: 'min', params: { min: 1 } }]);
      expect(error.providerMessage).toBe('Refused by the shop');
    });

    it('leaves everything empty when the body is not an envelope', () => {
      const error = new ApiError('text', 500, 'plain text');

      expect(error.code).toBeUndefined();
      expect(error.params).toEqual({});
      expect(error.fields).toEqual([]);
      expect(error.providerMessage).toBeUndefined();
    });
  });

  describe('legacy codes (#3863)', () => {
    it('reads an upper-snake code from error when the body has no code', () => {
      expect(new ApiError('x', 409, { error: 'ORDER_ALREADY_ON_HOLD' }).code).toBe('ORDER_ALREADY_ON_HOLD');
    });

    it('does not read an exception class name or a status title as a code', () => {
      expect(new ApiError('x', 409, { error: 'OrderAlreadyInvoicedException' }).code).toBeUndefined();
      expect(new ApiError('x', 404, { error: 'Not Found' }).code).toBeUndefined();
    });

    it('prefers the body code over error', () => {
      expect(new ApiError('x', 409, { code: 'A_CODE', error: 'OTHER_CODE' }).code).toBe('A_CODE');
    });
  });
});
