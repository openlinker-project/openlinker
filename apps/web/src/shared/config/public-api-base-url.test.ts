import { describe, expect, it } from 'vitest';
import { env } from './env';
import { publicApiBaseUrl } from './public-api-base-url';

describe('publicApiBaseUrl', () => {
  it('should return the configured API base URL without a trailing slash', () => {
    expect(publicApiBaseUrl()).toBe(env.VITE_API_BASE_URL.replace(/\/+$/, ''));
    expect(publicApiBaseUrl().endsWith('/')).toBe(false);
  });
});
