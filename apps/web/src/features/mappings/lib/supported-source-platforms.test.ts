/**
 * isSupportedSourcePlatform tests (#1784 follow-up S19)
 *
 * @module apps/web/src/features/mappings/lib
 */

import { describe, expect, it } from 'vitest';
import { isSupportedSourcePlatform } from './supported-source-platforms';

describe('isSupportedSourcePlatform', () => {
  it('returns false for undefined', () => {
    expect(isSupportedSourcePlatform(undefined)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isSupportedSourcePlatform('')).toBe(false);
  });

  it('returns true for an allowlisted platform (allegro)', () => {
    expect(isSupportedSourcePlatform('allegro')).toBe(true);
  });

  it('returns true for an allowlisted platform (erli)', () => {
    expect(isSupportedSourcePlatform('erli')).toBe(true);
  });

  it('returns false for a non-allowlisted platform (shopify)', () => {
    expect(isSupportedSourcePlatform('shopify')).toBe(false);
  });
});
