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
});
