/**
 * Fiscal Device Error Policy - spec (#3843)
 *
 * Pins what an operator may see for a terminal eparagony.pl `ERROR`: a
 * sentence per documented vendor code, the printer's code as digits, and an
 * explanation only for an exactly-recognised printer answer.
 */
import {
  GENERIC_TERMINAL_ERROR_REASON,
  readFiscalDeviceError,
} from '../fiscal-device-error.policy';

describe('readFiscalDeviceError', () => {
  it('should give code 83 its documented causes', () => {
    const reading = readFiscalDeviceError(83, undefined);

    expect(reading.reason).toContain('not fiscalized');
    expect(reading.reason.length).toBeLessThanOrEqual(200);
  });

  it('should keep the generic sentence for an undocumented code', () => {
    expect(readFiscalDeviceError(412, undefined).reason).toBe(GENERIC_TERMINAL_ERROR_REASON);
    expect(readFiscalDeviceError(null, undefined).reason).toBe(GENERIC_TERMINAL_ERROR_REASON);
  });

  it('should read the printer code with or without Polish letters', () => {
    expect(readFiscalDeviceError(83, 'Kod bledu drukarki: 16').deviceErrorCode).toBe('16');
    expect(readFiscalDeviceError(83, 'Kod błędu drukarki: 2106 - x').deviceErrorCode).toBe('2106');
  });

  it('should read no printer code when the description does not start with one', () => {
    expect(readFiscalDeviceError(83, 'Produkt 16 kod bledu drukarki: 7').deviceErrorCode).toBeNull();
    expect(readFiscalDeviceError(83, 42).deviceErrorCode).toBeNull();
  });

  it('should explain a documented printer answer that matches exactly', () => {
    const reading = readFiscalDeviceError(
      83,
      'Kod błędu drukarki: 16 - błędna nazwa towaru, prawdopodobnie brak znaków w kodowaniu Windows-1250, rozważ transliterację',
    );

    expect(reading.hint).toContain('product name');
  });

  it('should match a documented answer written without Polish letters', () => {
    const reading = readFiscalDeviceError(
      83,
      'Kod bledu drukarki: 18 - wystapil schodek podatkowy, sprawdz poprawnosc stawki VAT i/lub zmien nazwe towaru',
    );

    expect(reading.hint).toContain('VAT rate');
  });

  it('should not explain an answer that only starts like a documented one', () => {
    const reading = readFiscalDeviceError(
      83,
      'Kod błędu drukarki: 16 - błędna nazwa towaru: Secret Product Name',
    );

    expect(reading.deviceErrorCode).toBe('16');
    expect(reading.hint).toBeNull();
    expect(JSON.stringify(reading)).not.toContain('Secret Product Name');
  });

  it('should not explain the vendor code for an unknown cause', () => {
    expect(readFiscalDeviceError(83, 'Kod błędu drukarki: 99').hint).toBeNull();
  });
});
