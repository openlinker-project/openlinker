/**
 * Bulk config summary tests (#2227)
 *
 * Pins the policy descriptions, the changed-from-default list (an all-defaults
 * batch must produce NO entries, since that is what suppresses the bar's chip),
 * and the open-world `platformParams` formatting.
 */
import { describe, expect, it } from 'vitest';
import {
  buildBulkConfigRows,
  collectBulkConfigChanges,
  describePricingPolicy,
  describeStockPolicy,
  formatPlatformParamValue,
  humanizeParamKey,
  looksLikeIdentifier,
  readConnectionEnvironment,
} from './bulk-config-summary';
import type { BulkWizardConfig } from './bulk-wizard.types';

function makeConfig(over: Partial<BulkWizardConfig> = {}): BulkWizardConfig {
  return {
    connectionId: 'conn-1',
    platformParams: {},
    currency: 'PLN',
    pricingPolicy: { mode: 'use-master' },
    stockPolicy: { mode: 'use-master' },
    publishImmediately: true,
    generateDescription: false,
    ...over,
  };
}

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

describe('describePricingPolicy', () => {
  it('should describe every pricing mode', () => {
    expect(describePricingPolicy({ mode: 'use-master' }, 'PLN')).toBe('Master price');
    expect(describePricingPolicy({ mode: 'markup', percent: 12 }, 'PLN')).toBe('Master price +12%');
    expect(describePricingPolicy({ mode: 'flat', amount: 39 }, 'PLN')).toBe('Flat 39.00 PLN');
  });

  it('should not print a double sign when the markup is negative', () => {
    expect(describePricingPolicy({ mode: 'markup', percent: -5 }, 'PLN')).toBe('Master price -5%');
  });
});

describe('describeStockPolicy', () => {
  it('should describe every stock mode', () => {
    expect(describeStockPolicy({ mode: 'use-master' })).toBe('Master stock');
    expect(describeStockPolicy({ mode: 'cap', value: 20 })).toBe('Master stock, capped at 20');
    expect(describeStockPolicy({ mode: 'flat', value: 5 })).toBe('Flat 5');
  });
});

describe('collectBulkConfigChanges', () => {
  it('should report no changes when the batch runs entirely on defaults', () => {
    expect(collectBulkConfigChanges(makeConfig())).toEqual([]);
  });

  it('should report a single change when only the price policy moved', () => {
    expect(collectBulkConfigChanges(makeConfig({ pricingPolicy: { mode: 'markup', percent: 12 } }))).toEqual([
      { label: 'Price', value: 'Master price +12%' },
    ]);
  });

  it('should report every changed setting when several moved', () => {
    const changes = collectBulkConfigChanges(
      makeConfig({
        pricingPolicy: { mode: 'flat', amount: 39 },
        stockPolicy: { mode: 'cap', value: 20 },
        publishImmediately: false,
        generateDescription: true,
      }),
    );
    expect(changes.map((c) => c.label)).toEqual(['Price', 'Stock', 'On create', 'Description']);
  });
});

describe('formatPlatformParamValue', () => {
  it('should render every value shape readably', () => {
    expect(formatPlatformParamValue('Standard 24h')).toBe('Standard 24h');
    expect(formatPlatformParamValue(24)).toBe('24');
    expect(formatPlatformParamValue(true)).toBe('true');
    expect(formatPlatformParamValue(['a', 'b'])).toBe('a, b');
  });

  it('should report an absent value instead of an empty cell', () => {
    expect(formatPlatformParamValue(null)).toBe('Not set');
    expect(formatPlatformParamValue(undefined)).toBe('Not set');
    expect(formatPlatformParamValue('')).toBe('Not set');
    expect(formatPlatformParamValue([])).toBe('Not set');
  });

  it('should never surface an object as [object Object]', () => {
    expect(formatPlatformParamValue({ id: 7 })).toBe('{"id":7}');
  });
});

describe('humanizeParamKey', () => {
  it('should turn an open-world param key into a label', () => {
    expect(humanizeParamKey('dispatch_time')).toBe('Dispatch time');
    expect(humanizeParamKey('handlingTime')).toBe('Handling time');
  });

  it('should drop an Id suffix, which names the value shape rather than the setting', () => {
    expect(humanizeParamKey('deliveryPolicyId')).toBe('Delivery policy');
    expect(humanizeParamKey('return_policy_id')).toBe('Return policy');
  });

  it('should keep a key that is nothing but an id', () => {
    expect(humanizeParamKey('id')).toBe('Id');
  });
});

describe('looksLikeIdentifier', () => {
  it('should recognise a value the operator cannot read as words', () => {
    expect(looksLikeIdentifier('2012d84a-8c28-441c-b6cc-27e4bcbf8113')).toBe(true);
    expect(looksLikeIdentifier('ol_variant_e4b98e91340a44ed')).toBe(true);
  });

  it('should leave a human value alone', () => {
    expect(looksLikeIdentifier('Standard 24h')).toBe(false);
    expect(looksLikeIdentifier('24 h')).toBe(false);
    expect(looksLikeIdentifier('PLN')).toBe(false);
  });
});

describe('buildBulkConfigRows', () => {
  it('should list the whole config, ending with the integration and connection id', () => {
    const rows = buildBulkConfigRows({
      config: makeConfig({ platformParams: { deliveryPolicyId: 'Standard 24h' } }),
      platformLabel: 'Allegro',
      platformType: 'allegro',
      connectionIdLabel: 'conn…-1',
    });

    expect(rows.map((r) => r.id)).toEqual([
      'currency',
      'price',
      'stock',
      'on-create',
      'description',
      'param-deliveryPolicyId',
      'platform',
      'connection-id',
    ]);
    expect(rows.find((r) => r.id === 'platform')?.value).toBe('Allegro (allegro)');
    expect(rows.find((r) => r.id === 'connection-id')?.mono).toBe(true);
  });

  it('should say where the description comes from in both directions', () => {
    const base = { platformLabel: 'Allegro', platformType: 'allegro', connectionIdLabel: 'c' };
    const fromMaster = buildBulkConfigRows({ config: makeConfig(), ...base });
    const fromAi = buildBulkConfigRows({ config: makeConfig({ generateDescription: true }), ...base });

    expect(fromMaster.find((r) => r.id === 'description')?.value).toBe('From the master catalogue');
    expect(fromAi.find((r) => r.id === 'description')?.value).toBe('Written by AI');
  });
});
