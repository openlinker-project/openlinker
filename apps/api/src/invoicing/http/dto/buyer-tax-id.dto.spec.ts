/**
 * Buyer Tax Id DTO — validation spec (#1595)
 *
 * Exercises the scheme-scoped NIP mod-11 checksum constraint: a valid Polish
 * NIP, an invalid-format value, and a valid-format-but-invalid-checksum value
 * under `scheme: 'pl-nip'`, plus the pass-through for non-PL schemes.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { BuyerTaxIdDto } from './buyer-tax-id.dto';

function buildDto(payload: Record<string, unknown>): BuyerTaxIdDto {
  return plainToInstance(BuyerTaxIdDto, payload);
}

// 1189981779 has a correct mod-11 check digit; 1189981770 mutates it.
const VALID_NIP = '1189981779';
const INVALID_CHECKSUM_NIP = '1189981770';

describe('BuyerTaxIdDto', () => {
  it('should pass when scheme is pl-nip and the NIP is checksum-valid', async () => {
    const errors = await validate(buildDto({ scheme: 'pl-nip', value: VALID_NIP }));

    expect(errors).toHaveLength(0);
  });

  it('should pass when scheme is pl-nip and the NIP carries separators', async () => {
    const errors = await validate(buildDto({ scheme: 'pl-nip', value: '11-8998177-9' }));

    expect(errors).toHaveLength(0);
  });

  it('should reject a pl-nip value with a bad checksum', async () => {
    const errors = await validate(buildDto({ scheme: 'pl-nip', value: INVALID_CHECKSUM_NIP }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('plNipChecksum');
  });

  it('should reject an invalid-format pl-nip value', async () => {
    const errors = await validate(buildDto({ scheme: 'pl-nip', value: '12345' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('plNipChecksum');
  });

  it('should NOT checksum-validate a non-PL scheme (eu-vat passes through)', async () => {
    const errors = await validate(buildDto({ scheme: 'eu-vat', value: 'DE123456789' }));

    expect(errors).toHaveLength(0);
  });

  it('should still require scheme and value to be non-empty strings', async () => {
    const errors = await validate(buildDto({ scheme: '', value: '' }));

    expect(errors.length).toBeGreaterThan(0);
  });
});
