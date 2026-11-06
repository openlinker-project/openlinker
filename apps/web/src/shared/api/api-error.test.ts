/**
 * ApiError status-helper tests (#1625 — isConflict()).
 */
import { describe, expect, it } from 'vitest';
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
});
