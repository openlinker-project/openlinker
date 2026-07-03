/**
 * KSeF connection-config contribution tests (#1330)
 *
 * Relocated from `edit-connection.schema.test.ts` when the KSeF assembly moved
 * behind the `ConnectionConfigContribution` plugin slot — assertions unchanged.
 * Exercised through the same host composition path the edit form uses
 * (`buildEditConnectionSchema(ksefConnectionConfig)` +
 * `mergeStructuredIntoConfig(base, patch, ksefConnectionConfig)`), so the
 * per-keystroke partial-patch guarantees (#1311 smoke-test finding) stay
 * pinned end-to-end.
 */
import { describe, expect, it } from 'vitest';
import {
  buildEditConnectionSchema,
  mergeStructuredIntoConfig,
} from '../../features/connections';
import { ksefConnectionConfig } from './ksef-connection-config';
import { buildKsefSellerConfig, type KsefSellerProfileInput } from './lib/ksef-seller-config';

const ksefSchema = buildEditConnectionSchema(ksefConnectionConfig);

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
      ksefConnectionConfig,
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
    const result = mergeStructuredIntoConfig(base, { sellerCity: 'Gdańsk' }, ksefConnectionConfig);
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
    const result = mergeStructuredIntoConfig(base, { sellerCity: '' }, ksefConnectionConfig);
    expect('seller' in result).toBe(false);
  });

  it('does not touch config.seller when no seller sub-field is on the patch', () => {
    const base = { seller: { nip: '1234567890' }, env: 'test' };
    const result = mergeStructuredIntoConfig(base, { ksefEnvironment: 'demo' }, ksefConnectionConfig);
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
      const editSeller = mergeStructuredIntoConfig({}, input, ksefConnectionConfig).seller;
      expect(editSeller).toEqual(createSeller);
    });
  }

  it('does not write a hollow seller from a lone PL country default', () => {
    expect(buildKsefSellerConfig({ sellerCountryIso2: 'PL' })).toBeUndefined();
    expect(
      'seller' in mergeStructuredIntoConfig({}, { sellerCountryIso2: 'PL' }, ksefConnectionConfig),
    ).toBe(false);
  });
});

describe('composed edit schema — KSeF postal code validation (#1223)', () => {
  const base = {
    name: 'KSeF main',
    configText: '{"env":"prod"}',
  };

  it('rejects a malformed PL postal code', () => {
    const result = ksefSchema.safeParse({
      ...base,
      sellerPostalCode: '1234',
      sellerCountryIso2: 'PL',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed PL postal code', () => {
    const result = ksefSchema.safeParse({
      ...base,
      sellerPostalCode: '00-001',
      sellerCountryIso2: 'PL',
    });
    expect(result.success).toBe(true);
  });

  it('allows an empty postal code for incremental save', () => {
    const result = ksefSchema.safeParse({
      ...base,
      sellerPostalCode: '',
      sellerCountryIso2: 'PL',
    });
    expect(result.success).toBe(true);
  });

  it('skips the PL format check for a non-PL country', () => {
    const result = ksefSchema.safeParse({
      ...base,
      sellerPostalCode: 'SW1A 1AA',
      sellerCountryIso2: 'GB',
    });
    expect(result.success).toBe(true);
  });
});

describe('composed edit schema — KSeF payment bank account number length (#1311 tech-review)', () => {
  const base = {
    name: 'KSeF main',
    configText: '{"env":"prod"}',
  };

  it('rejects a bank account number shorter than 10 characters', () => {
    const result = ksefSchema.safeParse({
      ...base,
      paymentBankAccountNrRb: '123',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a bank account number at the 10-character lower bound', () => {
    const result = ksefSchema.safeParse({
      ...base,
      paymentBankAccountNrRb: '1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('allows an empty bank account number for incremental save', () => {
    const result = ksefSchema.safeParse({
      ...base,
      paymentBankAccountNrRb: '',
    });
    expect(result.success).toBe(true);
  });

  it('counts the whitespace-stripped length for a conventionally-spaced NRB paste', () => {
    const result = ksefSchema.safeParse({
      ...base,
      // 26 digits + 6 inner spaces = 32 raw chars; stripped length is what
      // the persisted wire value carries, so this must pass the 10-34 bound.
      paymentBankAccountNrRb: '61 1090 1014 0000 0000 9999 9999',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a spaced paste whose stripped length is under 10', () => {
    const result = ksefSchema.safeParse({
      ...base,
      paymentBankAccountNrRb: '12 34 56 78 9',
    });
    expect(result.success).toBe(false);
  });
});

describe('composed edit schema — KSeF skonto both-or-neither (#1311 tech-review)', () => {
  const base = {
    name: 'KSeF main',
    configText: '{"env":"prod"}',
  };

  it('accepts both skonto fields set', () => {
    const result = ksefSchema.safeParse({
      ...base,
      paymentSkontoConditions: 'paid within 7 days',
      paymentSkontoAmount: '2%',
    });
    expect(result.success).toBe(true);
  });

  it('accepts both skonto fields empty', () => {
    const result = ksefSchema.safeParse({
      ...base,
      paymentSkontoConditions: '',
      paymentSkontoAmount: '',
    });
    expect(result.success).toBe(true);
  });

  it('anchors the error on the missing amount when only conditions are set', () => {
    const result = ksefSchema.safeParse({
      ...base,
      paymentSkontoConditions: 'paid within 7 days',
      paymentSkontoAmount: '',
    });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.path.join('.'))).toContain(
      'paymentSkontoAmount',
    );
  });

  it('anchors the error on the missing conditions when only the amount is set', () => {
    const result = ksefSchema.safeParse({
      ...base,
      paymentSkontoConditions: '',
      paymentSkontoAmount: '2%',
    });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.path.join('.'))).toContain(
      'paymentSkontoConditions',
    );
  });
});

describe('composed edit schema — KSeF paymentTermDays sanity cap (#1311 tech-review)', () => {
  const base = {
    name: 'KSeF main',
    configText: '{"env":"prod"}',
  };

  it('accepts a term at the 999 upper bound', () => {
    const result = ksefSchema.safeParse({ ...base, paymentTermDays: '999' });
    expect(result.success).toBe(true);
  });

  it('rejects a term above the 999 sanity cap', () => {
    const result = ksefSchema.safeParse({ ...base, paymentTermDays: '1400' });
    expect(result.success).toBe(false);
  });
});

describe('mergeStructuredIntoConfig — KSeF payment (#1311)', () => {
  it('assembles the nested config.payment shape resolvePayment reads', () => {
    const result = mergeStructuredIntoConfig(
      { env: 'prod' },
      {
        paymentFormaPlatnosci: '6',
        paymentBankAccountNrRb: '61 1090 1014 0000 0000 9999 9999',
        paymentBankAccountBankName: 'Santander',
        paymentBankAccountSwift: 'WBKPPLPP',
        paymentTermDays: '14',
        paymentSkontoConditions: '2% if paid within 7 days',
        paymentSkontoAmount: '2%',
      },
      ksefConnectionConfig,
    );
    expect(result.payment).toEqual({
      formaPlatnosci: '6',
      bankAccount: {
        // Whitespace-stripped by `normalizeNrRb` at assembly time — inner
        // spaces never reach the persisted config or the FA(3) wire.
        nrRb: '61109010140000000099999999',
        bankName: 'Santander',
        swift: 'WBKPPLPP',
      },
      paymentTermDays: 14,
      skonto: { conditions: '2% if paid within 7 days', amount: '2%' },
    });
    expect(result.env).toBe('prod');
  });

  it('assembles formaPlatnosci-only (Gotówka, no bank account)', () => {
    const result = mergeStructuredIntoConfig({}, { paymentFormaPlatnosci: '1' }, ksefConnectionConfig);
    expect(result.payment).toEqual({ formaPlatnosci: '1' });
  });

  it('assembles bankAccount-only when nrRb is set without a payment method', () => {
    const result = mergeStructuredIntoConfig(
      {},
      { paymentBankAccountNrRb: '61109010140000000099999999' },
      ksefConnectionConfig,
    );
    expect(result.payment).toEqual({ bankAccount: { nrRb: '61109010140000000099999999' } });
  });

  it('preserves untouched payment siblings on a single-field patch', () => {
    const base = { payment: { formaPlatnosci: '6', paymentTermDays: 14 } };
    const result = mergeStructuredIntoConfig(
      base,
      { paymentSkontoConditions: 'text', paymentSkontoAmount: '5%' },
      ksefConnectionConfig,
    );
    expect(result.payment).toEqual({
      formaPlatnosci: '6',
      paymentTermDays: 14,
      skonto: { conditions: 'text', amount: '5%' },
    });
  });

  it('drops an emptied bankAccount object and an emptied payment object', () => {
    const base = { payment: { bankAccount: { nrRb: '61109010140000000099999999' } } };
    const result = mergeStructuredIntoConfig(base, { paymentBankAccountNrRb: '' }, ksefConnectionConfig);
    expect('payment' in result).toBe(false);
  });

  it('persists an incomplete skonto (missing amount) so per-keystroke sync never drops the first-typed field', () => {
    // Completeness (conditions+amount both present) is a save-time shape-validator
    // / issuance-time resolvePayment concern, not a persistence gate (#1311
    // smoke-test finding).
    const result = mergeStructuredIntoConfig(
      {},
      { paymentSkontoConditions: 'text only' },
      ksefConnectionConfig,
    );
    expect(result.payment).toEqual({ skonto: { conditions: 'text only' } });
  });

  it('treats a non-numeric paymentTermDays as clearing the field', () => {
    const base = { payment: { formaPlatnosci: '6', paymentTermDays: 14 } };
    const result = mergeStructuredIntoConfig(
      base,
      { paymentTermDays: 'not-a-number' },
      ksefConnectionConfig,
    );
    expect(result.payment).toEqual({ formaPlatnosci: '6' });
  });

  it('does not touch config.payment when no payment sub-field is on the patch', () => {
    const base = { payment: { formaPlatnosci: '6' }, env: 'test' };
    const result = mergeStructuredIntoConfig(base, { ksefEnvironment: 'demo' }, ksefConnectionConfig);
    expect(result.payment).toEqual({ formaPlatnosci: '6' });
    expect(result.env).toBe('demo');
  });
});

describe('ksefConnectionConfig.readConfigToForm — hydration', () => {
  it('hydrates environment, seller, payment, and context identifier from config', () => {
    const values = ksefConnectionConfig.readConfigToForm({
      env: 'prod',
      contextIdentifier: 'ctx-1',
      seller: {
        nip: '1234567890',
        name: 'ACME',
        address: { line1: 'ul. A 1', city: 'Kraków', postalCode: '30-001', countryIso2: 'PL' },
      },
      payment: {
        formaPlatnosci: '6',
        bankAccount: { nrRb: '61109010140000000099999999', bankName: 'Santander' },
        paymentTermDays: 14,
        skonto: { conditions: 'text', amount: '2%' },
      },
    });
    expect(values).toEqual({
      ksefEnvironment: 'prod',
      contextIdentifier: 'ctx-1',
      sellerNip: '1234567890',
      sellerName: 'ACME',
      sellerAddressLine1: 'ul. A 1',
      sellerAddressLine2: '',
      sellerCity: 'Kraków',
      sellerPostalCode: '30-001',
      sellerCountryIso2: 'PL',
      paymentFormaPlatnosci: '6',
      paymentBankAccountNrRb: '61109010140000000099999999',
      paymentBankAccountBankName: 'Santander',
      paymentBankAccountSwift: '',
      paymentTermDays: '14',
      paymentSkontoConditions: 'text',
      paymentSkontoAmount: '2%',
    });
  });

  it('falls back to the legacy flat config.sellerNip when config.seller.nip is absent', () => {
    const values = ksefConnectionConfig.readConfigToForm({ sellerNip: '1234567890' });
    expect(values.sellerNip).toBe('1234567890');
  });

  it('hydrates empty strings from an empty config so RHF register paths need no guards', () => {
    const values = ksefConnectionConfig.readConfigToForm({});
    expect(values.ksefEnvironment).toBe('');
    expect(values.sellerNip).toBe('');
    expect(values.paymentFormaPlatnosci).toBe('');
  });
});
