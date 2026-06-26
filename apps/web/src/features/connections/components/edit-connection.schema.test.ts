import { describe, expect, it } from 'vitest';
import { editConnectionSchema, mergeStructuredIntoConfig } from './edit-connection.schema';
import { buildKsefSellerConfig } from './ksef-setup.schema';
import type { KsefSellerProfileInput } from './ksef-seller-config';

describe('mergeStructuredIntoConfig', () => {
  it('writes a new baseUrl into an empty config', () => {
    const result = mergeStructuredIntoConfig({}, { baseUrl: 'https://shop.example.com' });
    expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
  });

  it('writes a new siteUrl into an empty config (WooCommerce, #975)', () => {
    const result = mergeStructuredIntoConfig({}, { siteUrl: 'https://wc.example.com' });
    expect(result).toEqual({ siteUrl: 'https://wc.example.com' });
  });

  it('deletes siteUrl when the structured input is cleared to an empty string', () => {
    const base = { siteUrl: 'https://wc.example.com', customField: 'preserve-me' };
    const result = mergeStructuredIntoConfig(base, { siteUrl: '' });
    expect(result).toEqual({ customField: 'preserve-me' });
    expect('siteUrl' in result).toBe(false);
  });

  it('overwrites an existing baseUrl without losing unknown keys', () => {
    const base = {
      baseUrl: 'https://old.example.com',
      customField: 'preserve-me',
      nested: { deep: true },
    };
    const result = mergeStructuredIntoConfig(base, { baseUrl: 'https://new.example.com' });
    expect(result).toEqual({
      baseUrl: 'https://new.example.com',
      customField: 'preserve-me',
      nested: { deep: true },
    });
  });

  it('deletes baseUrl when the structured input is cleared to an empty string', () => {
    const base = { baseUrl: 'https://shop.example.com', shopId: '1' };
    const result = mergeStructuredIntoConfig(base, { baseUrl: '' });
    expect(result).toEqual({ shopId: '1' });
    expect('baseUrl' in result).toBe(false);
  });

  it('leaves keys untouched when the structured patch omits them', () => {
    const base = { baseUrl: 'https://shop.example.com', shopId: '1' };
    const result = mergeStructuredIntoConfig(base, {});
    expect(result).toEqual(base);
  });

  it('deletes shopId when cleared but keeps baseUrl', () => {
    const base = { baseUrl: 'https://shop.example.com', shopId: '2' };
    const result = mergeStructuredIntoConfig(base, { shopId: '' });
    expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
  });

  it('does not mutate the base object', () => {
    const base = { baseUrl: 'https://shop.example.com', customField: 'x' };
    const snapshot = { ...base };
    mergeStructuredIntoConfig(base, { baseUrl: 'https://new.example.com' });
    expect(base).toEqual(snapshot);
  });

  it('writes storefrontBaseUrl into an empty config', () => {
    const result = mergeStructuredIntoConfig(
      {},
      { storefrontBaseUrl: 'https://shop.example.com' },
    );
    expect(result).toEqual({ storefrontBaseUrl: 'https://shop.example.com' });
  });

  it('deletes storefrontBaseUrl when cleared to empty string', () => {
    const base = {
      baseUrl: 'https://api.shop.example.com',
      storefrontBaseUrl: 'https://shop.example.com',
    };
    const result = mergeStructuredIntoConfig(base, { storefrontBaseUrl: '' });
    expect(result).toEqual({ baseUrl: 'https://api.shop.example.com' });
    expect('storefrontBaseUrl' in result).toBe(false);
  });

  describe('defaultCarrierId (#517)', () => {
    it('coerces a positive integer string into a number on write', () => {
      const result = mergeStructuredIntoConfig({}, { defaultCarrierId: '7' });
      expect(result).toEqual({ defaultCarrierId: 7 });
    });

    it('deletes the key when cleared to an empty string', () => {
      const base = { defaultCarrierId: 7, baseUrl: 'https://shop.example.com' };
      const result = mergeStructuredIntoConfig(base, { defaultCarrierId: '' });
      expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
      expect('defaultCarrierId' in result).toBe(false);
    });

    it('leaves the key untouched when the patch omits it', () => {
      const base = { defaultCarrierId: 7 };
      const result = mergeStructuredIntoConfig(base, { baseUrl: 'https://shop.example.com' });
      expect(result).toEqual({ defaultCarrierId: 7, baseUrl: 'https://shop.example.com' });
    });
  });

  describe('unmanagedStockQuantity (WooCommerce, #969 §7.3)', () => {
    it('writes a coerced number nested under inventory into an empty config', () => {
      const result = mergeStructuredIntoConfig({}, { unmanagedStockQuantity: '500' });
      expect(result).toEqual({ inventory: { unmanagedStockQuantity: 500 } });
    });

    it('preserves sibling inventory keys when overwriting', () => {
      const base = {
        siteUrl: 'https://wc.example.com',
        inventory: { unmanagedStockQuantity: 1000, futureKey: 'preserve-me' },
      };
      const result = mergeStructuredIntoConfig(base, { unmanagedStockQuantity: '250' });
      expect(result).toEqual({
        siteUrl: 'https://wc.example.com',
        inventory: { unmanagedStockQuantity: 250, futureKey: 'preserve-me' },
      });
    });

    it('deletes the key when cleared and drops an emptied inventory object', () => {
      const base = {
        siteUrl: 'https://wc.example.com',
        inventory: { unmanagedStockQuantity: 1000 },
      };
      const result = mergeStructuredIntoConfig(base, { unmanagedStockQuantity: '' });
      expect(result).toEqual({ siteUrl: 'https://wc.example.com' });
      expect('inventory' in result).toBe(false);
    });

    it('keeps the inventory object when clearing leaves sibling keys behind', () => {
      const base = { inventory: { unmanagedStockQuantity: 1000, futureKey: 'keep' } };
      const result = mergeStructuredIntoConfig(base, { unmanagedStockQuantity: '' });
      expect(result).toEqual({ inventory: { futureKey: 'keep' } });
    });

    it('leaves inventory untouched when the patch omits the field', () => {
      const base = { inventory: { unmanagedStockQuantity: 1000 } };
      const result = mergeStructuredIntoConfig(base, { siteUrl: 'https://wc.example.com' });
      expect(result).toEqual({
        inventory: { unmanagedStockQuantity: 1000 },
        siteUrl: 'https://wc.example.com',
      });
    });
  });
});

describe('editConnectionSchema — defaultCarrierId (#517)', () => {
  const validRest = {
    name: 'Shop',
    configText: '{}',
  };

  it('accepts an absent value', () => {
    const result = editConnectionSchema.safeParse(validRest);
    expect(result.success).toBe(true);
  });

  it('accepts an empty string (unset signal)', () => {
    const result = editConnectionSchema.safeParse({ ...validRest, defaultCarrierId: '' });
    expect(result.success).toBe(true);
  });

  it.each(['1', '7', '99'])(
    'accepts a positive-integer string (%s)',
    (value) => {
      const result = editConnectionSchema.safeParse({ ...validRest, defaultCarrierId: value });
      expect(result.success).toBe(true);
    },
  );

  it.each(['0', '-1', '7.5', 'abc', '1abc', ' '])(
    'rejects non-positive-integer input (%s) with the documented message',
    (value) => {
      const result = editConnectionSchema.safeParse({ ...validRest, defaultCarrierId: value });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('defaultCarrierId'));
        expect(issue?.message).toBe('Default carrier ID must be a positive integer.');
      }
    },
  );
});

// Direct-schema tests live here alongside the helper tests for symmetry with
// the existing file. Only the fields changed by #283 are covered today —
// extend as additional fields gain validation rules.
describe('editConnectionSchema — storefrontBaseUrl', () => {
  const validRest = {
    name: 'Shop',
    configText: '{}',
  };

  it('accepts an absent storefrontBaseUrl', () => {
    const result = editConnectionSchema.safeParse(validRest);
    expect(result.success).toBe(true);
  });

  it('accepts an empty string (unset signal)', () => {
    const result = editConnectionSchema.safeParse({ ...validRest, storefrontBaseUrl: '' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid https URL', () => {
    const result = editConnectionSchema.safeParse({
      ...validRest,
      storefrontBaseUrl: 'https://shop.example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a garbage value with the expected message', () => {
    const result = editConnectionSchema.safeParse({
      ...validRest,
      storefrontBaseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('storefrontBaseUrl'));
      expect(issue?.message).toBe('Storefront URL must be a valid URL');
    }
  });
});

describe('editConnectionSchema — siteUrl (WooCommerce, #975)', () => {
  const validRest = {
    name: 'Shop',
    configText: '{}',
  };

  it('accepts an absent siteUrl and an empty string (unset signal)', () => {
    expect(editConnectionSchema.safeParse(validRest).success).toBe(true);
    expect(editConnectionSchema.safeParse({ ...validRest, siteUrl: '' }).success).toBe(true);
  });

  it('accepts a valid https URL (including https localhost)', () => {
    expect(
      editConnectionSchema.safeParse({ ...validRest, siteUrl: 'https://wc.example.com' }).success,
    ).toBe(true);
    expect(
      editConnectionSchema.safeParse({ ...validRest, siteUrl: 'https://localhost:8443' }).success,
    ).toBe(true);
  });

  it('rejects a plain-http URL with the wizard-aligned message', () => {
    const result = editConnectionSchema.safeParse({
      ...validRest,
      siteUrl: 'http://wc.example.com',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('siteUrl'));
      expect(issue?.message).toBe('Site URL must use HTTPS');
    }
  });
});

describe('editConnectionSchema — unmanagedStockQuantity (WooCommerce, #969 §7.3)', () => {
  const validRest = {
    name: 'Shop',
    configText: '{}',
  };

  it('accepts an absent value and an empty string (unset signal)', () => {
    expect(editConnectionSchema.safeParse(validRest).success).toBe(true);
    expect(
      editConnectionSchema.safeParse({ ...validRest, unmanagedStockQuantity: '' }).success,
    ).toBe(true);
  });

  it.each(['1', '500', '9999'])('accepts a positive-integer string (%s)', (value) => {
    const result = editConnectionSchema.safeParse({
      ...validRest,
      unmanagedStockQuantity: value,
    });
    expect(result.success).toBe(true);
  });

  it.each(['0', '-5', '2.5', 'lots', ' '])(
    'rejects non-positive-integer input (%s) with the documented message',
    (value) => {
      const result = editConnectionSchema.safeParse({
        ...validRest,
        unmanagedStockQuantity: value,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('unmanagedStockQuantity'));
        expect(issue?.message).toBe('Unmanaged stock quantity must be a positive integer.');
      }
    },
  );
});

describe('mergeStructuredIntoConfig — inpostPsModuleType (#767/#1155)', () => {
  it("writes 'official_inpost' to config", () => {
    const result = mergeStructuredIntoConfig({}, { inpostPsModuleType: 'official_inpost' });
    expect(result).toEqual({ inpostPsModuleType: 'official_inpost' });
  });

  it('deletes the key when cleared to empty string', () => {
    const base = {
      inpostPsModuleType: 'official_inpost',
      baseUrl: 'https://shop.example.com',
    };
    const result = mergeStructuredIntoConfig(base, { inpostPsModuleType: '' });
    expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
    expect('inpostPsModuleType' in result).toBe(false);
  });

  it('leaves key untouched when the patch omits it', () => {
    const base = { inpostPsModuleType: 'official_inpost' };
    const result = mergeStructuredIntoConfig(base, { baseUrl: 'https://shop.example.com' });
    expect(result).toEqual({
      inpostPsModuleType: 'official_inpost',
      baseUrl: 'https://shop.example.com',
    });
  });

  it('does not create the key when empty string is patched into an empty config', () => {
    const result = mergeStructuredIntoConfig({}, { inpostPsModuleType: '' });
    expect('inpostPsModuleType' in result).toBe(false);
  });
});

describe('mergeStructuredIntoConfig — KSeF seller profile (#1223)', () => {
  it('assembles the nested config.seller shape resolveSeller reads', () => {
    const result = mergeStructuredIntoConfig(
      { env: 'prod' },
      {
        sellerNip: '12-3456789-0',
        sellerName: 'ACME Sp. z o.o.',
        sellerAddressLine1: 'ul. Przykładowa 1',
        sellerCity: 'Warszawa',
        sellerPostalCode: '00-001',
        sellerCountryIso2: 'pl',
      },
    );
    // NIP normalised to digits, country upper-cased, blank line2 omitted.
    expect(result.seller).toEqual({
      nip: '1234567890',
      name: 'ACME Sp. z o.o.',
      address: {
        line1: 'ul. Przykładowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        countryIso2: 'PL',
      },
    });
    // No flat sellerNip — the canonical location is config.seller.nip.
    expect(result.sellerNip).toBeUndefined();
    expect(result.env).toBe('prod');
  });

  it('preserves untouched seller siblings on a single-field patch', () => {
    const base = {
      seller: {
        nip: '1234567890',
        name: 'ACME',
        address: { line1: 'ul. A 1', city: 'Kraków', postalCode: '30-001', countryIso2: 'PL' },
      },
    };
    const result = mergeStructuredIntoConfig(base, { sellerCity: 'Gdańsk' });
    expect(result.seller).toEqual({
      nip: '1234567890',
      name: 'ACME',
      address: { line1: 'ul. A 1', city: 'Gdańsk', postalCode: '30-001', countryIso2: 'PL' },
    });
  });

  it('drops an emptied address object and an emptied seller object', () => {
    const base = {
      seller: { address: { city: 'Łódź' } },
    };
    const result = mergeStructuredIntoConfig(base, { sellerCity: '' });
    expect('seller' in result).toBe(false);
  });

  it('does not touch config.seller when no seller sub-field is on the patch', () => {
    const base = { seller: { nip: '1234567890' }, env: 'test' };
    const result = mergeStructuredIntoConfig(base, { ksefEnvironment: 'demo' });
    expect(result.seller).toEqual({ nip: '1234567890' });
    expect(result.env).toBe('demo');
  });
});

describe('KSeF seller assembly — create/edit parity (#1223)', () => {
  // Feeds the identical flat seller input through the create path
  // (buildKsefSellerConfig) and the edit path (mergeStructuredIntoConfig onto an
  // empty config) and asserts both produce the same nested config.seller. Guards
  // against the two flows' normalization/assembly drifting apart now that they
  // share one source (ksef-seller-config).
  const cases: Array<{ name: string; input: KsefSellerProfileInput }> = [
    {
      name: 'full profile with separators + lower-case country',
      input: {
        sellerNip: '12-3456789-0',
        sellerName: '  ACME Sp. z o.o.  ',
        sellerAddressLine1: ' ul. Przykładowa 1 ',
        sellerAddressLine2: '',
        sellerCity: 'Warszawa',
        sellerPostalCode: '00-001',
        sellerCountryIso2: 'pl',
      },
    },
    {
      name: 'NIP only, no address',
      input: { sellerNip: '1234567890' },
    },
    {
      name: 'name + partial address',
      input: { sellerName: 'Solo', sellerCity: 'Kraków' },
    },
    {
      name: 'lone country default (hollow profile)',
      input: { sellerCountryIso2: 'PL' },
    },
    {
      name: 'completely empty',
      input: {},
    },
  ];

  for (const { name, input } of cases) {
    it(`produces identical config.seller via create and edit paths — ${name}`, () => {
      const createSeller = buildKsefSellerConfig(input);
      const editSeller = mergeStructuredIntoConfig({}, input).seller;
      expect(editSeller).toEqual(createSeller);
    });
  }

  it('does not write a hollow seller from a lone PL country default', () => {
    expect(buildKsefSellerConfig({ sellerCountryIso2: 'PL' })).toBeUndefined();
    expect('seller' in mergeStructuredIntoConfig({}, { sellerCountryIso2: 'PL' })).toBe(false);
  });
});

describe('editConnectionSchema — KSeF postal code validation (#1223)', () => {
  const base = {
    name: 'KSeF main',
    configText: '{"env":"prod"}',
  };

  it('rejects a malformed PL postal code', () => {
    const result = editConnectionSchema.safeParse({
      ...base,
      sellerPostalCode: '1234',
      sellerCountryIso2: 'PL',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed PL postal code', () => {
    const result = editConnectionSchema.safeParse({
      ...base,
      sellerPostalCode: '00-001',
      sellerCountryIso2: 'PL',
    });
    expect(result.success).toBe(true);
  });

  it('allows an empty postal code for incremental save', () => {
    const result = editConnectionSchema.safeParse({
      ...base,
      sellerPostalCode: '',
      sellerCountryIso2: 'PL',
    });
    expect(result.success).toBe(true);
  });

  it('skips the PL format check for a non-PL country', () => {
    const result = editConnectionSchema.safeParse({
      ...base,
      sellerPostalCode: 'SW1A 1AA',
      sellerCountryIso2: 'GB',
    });
    expect(result.success).toBe(true);
  });
});
