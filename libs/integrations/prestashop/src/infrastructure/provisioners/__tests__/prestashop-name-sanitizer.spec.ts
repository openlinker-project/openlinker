import { sanitizePrestashopName, toPrestashopCompanyNote } from '../prestashop-name-sanitizer';

describe('sanitizePrestashopName', () => {
  it('should strip digits and forbidden characters when the name contains them', () => {
    expect(sanitizePrestashopName('c12-pay', 'Customer')).toEqual({ value: 'c-pay', changed: true });
    expect(sanitizePrestashopName('Acme_Corp (PL)', 'Customer').value).toBe('AcmeCorp PL');
  });

  it('should keep unicode letters, hyphens and apostrophes when the name is valid', () => {
    expect(sanitizePrestashopName("Żółć-O'Neil", 'Customer')).toEqual({
      value: "Żółć-O'Neil",
      changed: false,
    });
  });

  it('should fall back to the placeholder when nothing usable is left', () => {
    expect(sanitizePrestashopName('1234', 'Customer')).toEqual({ value: 'Customer', changed: true });
  });

  it('should fall back without flagging a change when the name is missing', () => {
    expect(sanitizePrestashopName(null, 'Guest')).toEqual({ value: 'Guest', changed: false });
    expect(sanitizePrestashopName('   ', 'Guest')).toEqual({ value: 'Guest', changed: false });
  });
});

describe('toPrestashopCompanyNote', () => {
  it('should join the original parts and drop generic-name forbidden characters', () => {
    expect(toPrestashopCompanyNote(['Jan', 'c12-pay<x>'])).toBe('Jan c12-payx');
  });
});
