/**
 * KSeF NIP checksum tests (#1595)
 *
 * Covers the mod-11 pure validator and the seller-NIP schema gate: a valid NIP,
 * an invalid-format NIP, and a valid-format-but-invalid-checksum NIP.
 */
import { describe, expect, it } from 'vitest';
import { isValidNipChecksum, normalizeNip } from './ksef-nip';
import { ksefSetupSchema, KSEF_SETUP_DEFAULT_VALUES } from '../components/ksef-setup.schema';

// 1189981779 has a correct mod-11 check digit (9); 1189981770 mutates it.
const VALID_NIP = '1189981779';
const INVALID_CHECKSUM_NIP = '1189981770';

describe('isValidNipChecksum', () => {
  it('accepts a checksum-valid 10-digit NIP', () => {
    expect(isValidNipChecksum(VALID_NIP)).toBe(true);
  });

  it('rejects a valid-format NIP with a wrong check digit', () => {
    expect(isValidNipChecksum(INVALID_CHECKSUM_NIP)).toBe(false);
  });

  it('rejects an invalid-format value (wrong length / non-digits)', () => {
    expect(isValidNipChecksum('12345')).toBe(false);
    expect(isValidNipChecksum('12345678a0')).toBe(false);
    expect(isValidNipChecksum('11899817790')).toBe(false);
  });

  it('rejects a NIP whose mod-11 remainder is 10', () => {
    // 5272514610 -> first 9 digits sum mod 11 == 10, never a legal check digit.
    expect(isValidNipChecksum('5272514610')).toBe(false);
  });
});

describe('ksefSetupSchema sellerNip checksum gate', () => {
  const base = { ...KSEF_SETUP_DEFAULT_VALUES, name: 'Conn', secret: 's' };

  it('accepts a checksum-valid seller NIP (separators stripped)', () => {
    const result = ksefSetupSchema.safeParse({ ...base, sellerNip: '11-8998177-9' });
    expect(result.success).toBe(true);
  });

  it('rejects a valid-format seller NIP with a bad checksum', () => {
    const result = ksefSetupSchema.safeParse({ ...base, sellerNip: INVALID_CHECKSUM_NIP });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid-format seller NIP', () => {
    const result = ksefSetupSchema.safeParse({ ...base, sellerNip: '12345' });
    expect(result.success).toBe(false);
  });

  it('still allows an empty seller NIP (incremental save)', () => {
    const result = ksefSetupSchema.safeParse({ ...base, sellerNip: '' });
    expect(result.success).toBe(true);
  });
});

describe('normalizeNip', () => {
  it('strips dashes and spaces', () => {
    expect(normalizeNip('11-8998 177-9')).toBe(VALID_NIP);
  });
});
