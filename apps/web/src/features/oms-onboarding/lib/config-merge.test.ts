import { describe, expect, it } from 'vitest';

import {
  readSourcingClaim,
  readStockLocationOverride,
  withConfigKey,
  withSourcingClaimEnabled,
} from './config-merge';

describe('withConfigKey', () => {
  it('should keep every unrelated key, because PATCH replaces config whole', () => {
    const config = { baseUrl: 'https://shop.example', rateLimit: { perMinute: 60 }, stockSafetyBuffer: 2 };
    expect(withConfigKey(config, 'stockLocationOverride', 'loc-1')).toEqual({
      ...config,
      stockLocationOverride: 'loc-1',
    });
  });

  it('should not mutate the config it was given', () => {
    const config = { baseUrl: 'x' };
    withConfigKey(config, 'k', 1);
    expect(config).toEqual({ baseUrl: 'x' });
  });

  it('should tolerate a missing config', () => {
    expect(withConfigKey(null, 'k', 1)).toEqual({ k: 1 });
  });
});

describe('withSourcingClaimEnabled', () => {
  it('should keep the claim object and its scopes when stopping', () => {
    const config = { other: true, sourcingAuthority: { enabled: true, scopes: ['a'], isPrimary: true } };
    expect(withSourcingClaimEnabled(config, false)).toEqual({
      other: true,
      sourcingAuthority: { enabled: false, scopes: ['a'], isPrimary: true },
    });
  });

  it('should write the object form over a boolean claim', () => {
    expect(withSourcingClaimEnabled({ sourcingAuthority: true }, false)).toEqual({
      sourcingAuthority: { enabled: false },
    });
  });
});

describe('readSourcingClaim', () => {
  it('should tell "never set up" apart from "switched off"', () => {
    expect(readSourcingClaim({})).toBe('unset');
    expect(readSourcingClaim({ sourcingAuthority: { enabled: false } })).toBe('off');
  });

  it('should read every shape the backend accepts as on', () => {
    expect(readSourcingClaim({ sourcingAuthority: true })).toBe('on');
    expect(readSourcingClaim({ sourcingAuthority: 'true' })).toBe('on');
    expect(readSourcingClaim({ sourcingAuthority: { enabled: true } })).toBe('on');
  });
});

describe('readStockLocationOverride', () => {
  it('should read a set override and treat blank as unset', () => {
    expect(readStockLocationOverride({ stockLocationOverride: 'loc-1' })).toBe('loc-1');
    expect(readStockLocationOverride({ stockLocationOverride: '  ' })).toBeNull();
    expect(readStockLocationOverride({})).toBeNull();
  });
});
