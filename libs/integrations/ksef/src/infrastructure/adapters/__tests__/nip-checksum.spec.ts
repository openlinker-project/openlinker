/**
 * NIP checksum unit tests (#1595)
 *
 * Direct coverage of the mod-11 pure validator: a valid NIP, an invalid-format
 * NIP, a valid-format-but-invalid-checksum NIP, and the illegal mod-11-remainder
 * -of-10 case.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters/__tests__
 */
import { isValidNipChecksum } from '../nip-checksum';

describe('isValidNipChecksum', () => {
  it('accepts a checksum-valid 10-digit NIP', () => {
    // 1189981779 -> check digit 9.
    expect(isValidNipChecksum('1189981779')).toBe(true);
  });

  it('rejects a valid-format NIP with a wrong check digit', () => {
    expect(isValidNipChecksum('1189981770')).toBe(false);
  });

  it('rejects an invalid-format value (wrong length / non-digits)', () => {
    expect(isValidNipChecksum('12345')).toBe(false);
    expect(isValidNipChecksum('12345678a0')).toBe(false);
    expect(isValidNipChecksum('11899817790')).toBe(false);
  });

  it('rejects a NIP whose mod-11 remainder is 10', () => {
    expect(isValidNipChecksum('5272514610')).toBe(false);
  });
});
