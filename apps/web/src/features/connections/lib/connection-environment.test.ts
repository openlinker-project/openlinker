/**
 * Connection environment reader tests (#2227, #3670)
 *
 * @module features/connections/lib
 */
import { describe, expect, it } from 'vitest';
import { readConnectionEnvironment } from './connection-environment';

describe('readConnectionEnvironment', () => {
  it('should return the environment when the config carries a known value', () => {
    expect(readConnectionEnvironment({ environment: 'sandbox' })).toBe('sandbox');
    expect(readConnectionEnvironment({ environment: 'production' })).toBe('production');
  });

  it('should return null when the environment is absent, unknown or not a string', () => {
    expect(readConnectionEnvironment({})).toBeNull();
    expect(readConnectionEnvironment(undefined)).toBeNull();
    expect(readConnectionEnvironment({ environment: 'staging' })).toBeNull();
    expect(readConnectionEnvironment({ environment: 1 })).toBeNull();
  });
});
