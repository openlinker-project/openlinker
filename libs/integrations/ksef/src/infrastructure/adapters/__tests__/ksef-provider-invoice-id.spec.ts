/**
 * Provider-invoice-id codec specs — round-trip + malformed handling.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import {
  decodeProviderInvoiceId,
  encodeProviderInvoiceId,
} from '../ksef-provider-invoice-id';

describe('ksef-provider-invoice-id', () => {
  it('should round-trip a session ref + invoice ref through encode/decode', () => {
    const encoded = encodeProviderInvoiceId('SESSION-REF-001', 'INVOICE-REF-001');
    expect(encoded).toBe('SESSION-REF-001:INVOICE-REF-001');
    expect(decodeProviderInvoiceId(encoded)).toEqual({
      sessionRef: 'SESSION-REF-001',
      invoiceRef: 'INVOICE-REF-001',
    });
  });

  it('should return null when the value carries no delimiter (legacy record)', () => {
    expect(decodeProviderInvoiceId('INVOICE-REF-ONLY')).toBeNull();
  });

  it('should return null when the delimiter is leading or trailing', () => {
    expect(decodeProviderInvoiceId(':INVOICE-REF-001')).toBeNull();
    expect(decodeProviderInvoiceId('SESSION-REF-001:')).toBeNull();
  });
});
