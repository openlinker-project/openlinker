/**
 * InPost setup schema tests (#771)
 *
 * Covers the form → CreateConnectionInput mapping (nested sender address +
 * address sub-object, optional sender name, credentials split) and the
 * validation mirrors of the BE config validator (PL postcode, ISO country,
 * required fields).
 *
 * @module features/connections/components
 */
import { describe, expect, it } from 'vitest';

import {
  INPOST_ADAPTER_KEY,
  INPOST_SETUP_DEFAULT_VALUES,
  inpostSetupSchema,
  toCreateConnectionInput,
  type InpostSetupFormSubmission,
} from './inpost-setup.schema';

function validValues(overrides: Partial<InpostSetupFormSubmission> = {}): InpostSetupFormSubmission {
  return {
    name: 'InPost — main',
    apiToken: 'shipx-token-123',
    environment: 'sandbox',
    organizationId: '123456',
    senderName: 'Sklep ACME',
    senderEmail: 'magazyn@acme.pl',
    senderPhone: '+48111222333',
    senderStreet: 'ul. Magazynowa',
    senderBuildingNumber: '1',
    senderCity: 'Warszawa',
    senderPostCode: '00-001',
    senderCountryCode: 'PL',
    ...overrides,
  };
}

describe('inpostSetupSchema', () => {
  it('rejects the incomplete defaults', () => {
    const result = inpostSetupSchema.safeParse(INPOST_SETUP_DEFAULT_VALUES);
    expect(result.success).toBe(false);
  });

  it('rejects a non-PL postcode', () => {
    const result = inpostSetupSchema.safeParse(validValues({ senderPostCode: '00001' }));
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = inpostSetupSchema.safeParse(validValues({ senderEmail: 'not-an-email' }));
    expect(result.success).toBe(false);
  });

  it('uppercases and validates the country code', () => {
    const result = inpostSetupSchema.safeParse(validValues({ senderCountryCode: 'pl' }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.senderCountryCode).toBe('PL');
  });
});

describe('toCreateConnectionInput', () => {
  it('builds the nested config + credentials with the InPost adapter key', () => {
    const input = toCreateConnectionInput(validValues());
    expect(input.platformType).toBe('inpost');
    expect(input.adapterKey).toBe(INPOST_ADAPTER_KEY);
    expect(input.credentials).toEqual({ apiToken: 'shipx-token-123' });
    expect(input.config).toMatchObject({
      environment: 'sandbox',
      organizationId: '123456',
      senderAddress: {
        name: 'Sklep ACME',
        email: 'magazyn@acme.pl',
        phone: '+48111222333',
        address: {
          street: 'ul. Magazynowa',
          buildingNumber: '1',
          city: 'Warszawa',
          postCode: '00-001',
          countryCode: 'PL',
        },
      },
    });
    // enabledCapabilities omitted so the API defaults to the adapter's set.
    expect(input.enabledCapabilities).toBeUndefined();
  });

  it('drops the optional sender name when blank', () => {
    const input = toCreateConnectionInput(validValues({ senderName: '' }));
    const sender = (input.config as { senderAddress: Record<string, unknown> }).senderAddress;
    expect(sender.name).toBeUndefined();
    expect(sender.email).toBe('magazyn@acme.pl');
  });
});
