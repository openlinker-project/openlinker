import { describe, expect, it } from 'vitest';

import {
  readAutoDispatch,
  readSourcingClaim,
  readStockLocationOverride,
  withAutoDispatch,
  withConfigKey,
  withPackingClaimsEnabled,
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

describe('withPackingClaimsEnabled', () => {
  it('should write both the sourcing and executor claims when turning packing on', () => {
    expect(withPackingClaimsEnabled({ baseUrl: 'x' }, true)).toEqual({
      baseUrl: 'x',
      sourcingAuthority: { enabled: true },
      fulfillmentExecutor: { enabled: true },
    });
  });

  it('should keep each claim\'s other fields when turning packing off', () => {
    expect(
      withPackingClaimsEnabled(
        { sourcingAuthority: { enabled: true, isPrimary: true }, fulfillmentExecutor: { enabled: true } },
        false
      )
    ).toEqual({
      sourcingAuthority: { enabled: false, isPrimary: true },
      fulfillmentExecutor: { enabled: false },
    });
  });
});

describe('readAutoDispatch', () => {
  it('should read nothing chosen when the key is absent or not an object', () => {
    expect(readAutoDispatch({})).toBeNull();
    expect(readAutoDispatch(null)).toBeNull();
    expect(readAutoDispatch({ autoDispatch: true })).toBeNull();
    expect(readAutoDispatch({ autoDispatch: [] })).toBeNull();
  });

  it('should read enabled only when it is exactly true, as the worker does', () => {
    expect(readAutoDispatch({ autoDispatch: { enabled: true } })?.enabled).toBe(true);
    expect(readAutoDispatch({ autoDispatch: { enabled: 'true' } })?.enabled).toBe(false);
    expect(readAutoDispatch({ autoDispatch: {} })?.enabled).toBe(false);
  });

  it('should keep the parcel defaults of a switched-off setting for the restart', () => {
    expect(
      readAutoDispatch({ autoDispatch: { enabled: false, parcelTemplate: 'medium', defaultWeightGrams: 500 } })
    ).toEqual({ enabled: false, parcelTemplate: 'medium', defaultWeightGrams: 500 });
  });

  it('should read the box only as a full set and drop non-positive values', () => {
    expect(
      readAutoDispatch({ autoDispatch: { enabled: true, lengthMm: 300, widthMm: 200, defaultWeightGrams: 0 } })
    ).toEqual({ enabled: true });
    expect(
      readAutoDispatch({ autoDispatch: { enabled: true, lengthMm: 300, widthMm: 200, heightMm: 100 } })
    ).toEqual({ enabled: true, lengthMm: 300, widthMm: 200, heightMm: 100 });
  });

  it('should treat a blank size as no size', () => {
    expect(readAutoDispatch({ autoDispatch: { enabled: true, parcelTemplate: '  ' } })).toEqual({ enabled: true });
  });
});

describe('withAutoDispatch', () => {
  it('should keep every unrelated key, because PATCH replaces config whole', () => {
    const config = { baseUrl: 'x', sourcingAuthority: { enabled: true }, stockSafetyBuffer: 2 };
    expect(withAutoDispatch(config, { enabled: true, defaultWeightGrams: 500 })).toEqual({
      ...config,
      autoDispatch: { enabled: true, defaultWeightGrams: 500 },
    });
  });

  it('should drop a partial box, which the server would refuse', () => {
    expect(
      withAutoDispatch({}, { enabled: true, defaultWeightGrams: 500, lengthMm: 300, widthMm: 200 })
    ).toEqual({ autoDispatch: { enabled: true, defaultWeightGrams: 500 } });
  });

  it('should write a full box and a trimmed size', () => {
    expect(
      withAutoDispatch({}, {
        enabled: true,
        parcelTemplate: ' medium ',
        defaultWeightGrams: 500,
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
      })
    ).toEqual({
      autoDispatch: {
        enabled: true,
        parcelTemplate: 'medium',
        defaultWeightGrams: 500,
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
      },
    });
  });

  it('should replace an earlier setting rather than merge into it', () => {
    const config = { autoDispatch: { enabled: true, parcelTemplate: 'large', lengthMm: 1, widthMm: 1, heightMm: 1 } };
    expect(withAutoDispatch(config, { enabled: true, defaultWeightGrams: 250 })).toEqual({
      autoDispatch: { enabled: true, defaultWeightGrams: 250 },
    });
  });
});
