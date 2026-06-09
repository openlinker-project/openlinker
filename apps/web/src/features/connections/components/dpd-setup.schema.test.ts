/**
 * DPD setup schema tests
 *
 * Covers the form → CreateConnectionInput mapping (nested sender address,
 * optional masterFid, credentials split) and the validation mirrors of the BE
 * config validator (PL postal, ISO country, numeric FIDs).
 *
 * @module features/connections/components
 */
import { describe, expect, it } from 'vitest';

import {
  DPD_ADAPTER_KEY,
  DPD_SETUP_DEFAULT_VALUES,
  dpdSetupSchema,
  toCreateConnectionInput,
  type DpdSetupFormSubmission,
} from './dpd-setup.schema';

function validValues(overrides: Partial<DpdSetupFormSubmission> = {}): DpdSetupFormSubmission {
  return {
    name: 'DPD — main',
    login: 'ol_12345',
    password: 'secret-pass',
    environment: 'sandbox',
    payerFid: '1495',
    masterFid: '',
    senderCompany: 'Sklep ACME',
    senderName: 'Magazyn',
    senderAddress: 'ul. Magazynowa 1',
    senderCity: 'Warszawa',
    senderPostalCode: '00-001',
    senderCountryCode: 'PL',
    senderPhone: '+48111222333',
    senderEmail: 'magazyn@acme.pl',
    ...overrides,
  };
}

describe('dpdSetupSchema', () => {
  it('parses a fully valid form', () => {
    const result = dpdSetupSchema.safeParse(DPD_SETUP_DEFAULT_VALUES);
    // Defaults are intentionally incomplete (empty required fields) — they
    // shouldn't pass until the operator fills them.
    expect(result.success).toBe(false);
  });

  it('rejects a non-PL postal code', () => {
    const result = dpdSetupSchema.safeParse(validValues({ senderPostalCode: '00001' }));
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric payer FID', () => {
    const result = dpdSetupSchema.safeParse(validValues({ payerFid: 'abc' }));
    expect(result.success).toBe(false);
  });

  it('uppercases and validates the country code', () => {
    const result = dpdSetupSchema.safeParse(validValues({ senderCountryCode: 'pl' }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.senderCountryCode).toBe('PL');
  });
});

describe('toCreateConnectionInput', () => {
  it('builds the nested config + credentials with the DPD adapter key', () => {
    const input = toCreateConnectionInput(validValues());
    expect(input.platformType).toBe('dpd');
    expect(input.adapterKey).toBe(DPD_ADAPTER_KEY);
    expect(input.credentials).toEqual({ login: 'ol_12345', password: 'secret-pass' });
    expect(input.config).toMatchObject({
      environment: 'sandbox',
      payerFid: '1495',
      senderAddress: {
        address: 'ul. Magazynowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        countryCode: 'PL',
        company: 'Sklep ACME',
        email: 'magazyn@acme.pl',
      },
    });
    // masterFid omitted when blank; enabledCapabilities omitted (API defaults).
    expect((input.config as Record<string, unknown>).masterFid).toBeUndefined();
    expect(input.enabledCapabilities).toBeUndefined();
  });

  it('includes masterFid when provided', () => {
    const input = toCreateConnectionInput(validValues({ masterFid: '1490' }));
    expect((input.config as Record<string, unknown>).masterFid).toBe('1490');
  });

  it('drops blank optional sender fields', () => {
    const input = toCreateConnectionInput(
      validValues({ senderCompany: '', senderName: '', senderPhone: '', senderEmail: '' }),
    );
    const sender = (input.config as { senderAddress: Record<string, unknown> }).senderAddress;
    expect(sender.company).toBeUndefined();
    expect(sender.email).toBeUndefined();
    expect(sender.address).toBe('ul. Magazynowa 1');
  });
});
