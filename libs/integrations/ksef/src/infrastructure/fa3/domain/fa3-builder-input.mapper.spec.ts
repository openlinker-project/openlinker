/**
 * Neutral → FA(3) Builder-Input Mapper — Unit Specs
 *
 * Pins the empty-`taxRate` → connection-`defaultTaxRate` fallback (#1290):
 * an empty neutral rate resolves via the seller's default; a non-empty rate
 * is never overridden (including a genuinely unmapped one, which still
 * throws); the same fallback applies to correction lines.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { BuyerProfile, type IssueInvoiceCommand } from '@openlinker/core/invoicing';
import { UnmappedTaxRateException } from '../../../domain/exceptions/fa3-builder.exception';
import { mapToFa3BuilderInput, type Fa3MappingContext } from './fa3-builder-input.mapper';
import type { SellerProfile } from './fa3-xml.types';

const SELLER: SellerProfile = {
  nip: '1234567890',
  name: 'Acme Sp. z o.o.',
  address: { line1: 'ul. Testowa 1', line2: null, city: 'Warszawa', postalCode: '00-001', countryIso2: 'PL' },
  defaultTaxRate: '8',
};

const CONTEXT: Fa3MappingContext = {
  seller: SELLER,
  issueDate: '2026-07-01',
  generatedAt: '2026-07-01T00:00:00.000Z',
  invoiceNumber: 'ol_order_test_001',
};

function baseCommand(taxRate: string): IssueInvoiceCommand {
  return {
    connectionId: 'conn-1',
    orderId: 'ol_order_test_001',
    buyer: new BuyerProfile(
      'Jan Kowalski',
      null,
      { line1: 'ul. Kupiecka 2', line2: null, city: 'Kraków', postalCode: '30-001', countryIso2: 'PL' },
      'private',
    ),
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate }],
  };
}

describe('mapToFa3BuilderInput — tax-rate fallback', () => {
  it('should resolve an empty neutral taxRate to the seller defaultTaxRate', () => {
    const result = mapToFa3BuilderInput(baseCommand(''), CONTEXT);
    expect(result.lines[0].p12).toBe('8');
  });

  it('should not override an explicit, mapped neutral taxRate with the default', () => {
    const result = mapToFa3BuilderInput(baseCommand('23'), CONTEXT);
    expect(result.lines[0].p12).toBe('23');
  });

  it('should still throw UnmappedTaxRateException for a non-empty unmapped taxRate', () => {
    expect(() => mapToFa3BuilderInput(baseCommand('bogus'), CONTEXT)).toThrow(
      UnmappedTaxRateException,
    );
  });

  it('should apply the same fallback to correction lines', () => {
    const cmd = baseCommand('23');
    cmd.correction = {
      originalClearanceReference: null,
      originalDocumentNumber: 'FA/2026/06/0001',
      originalIssueDate: '2026-06-01',
      reason: 'Return',
      correctedLines: [{ name: 'Widget', quantity: 1, unitPriceGross: 90, taxRate: '' }],
    };

    const result = mapToFa3BuilderInput(cmd, CONTEXT);

    expect(result.correction?.correctedLines[0].p12).toBe('8');
  });
});
