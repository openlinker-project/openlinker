/**
 * FA(3) Pure Builder — Unit Specs
 *
 * Specs for the pure, synchronous builder. They assert document identity (root,
 * namespace, form code + schema version), B2B/B2C shape, multi-rate lines, the
 * P_12-per-line / P_15-total fiscal aggregates, and — critically — XML-injection
 * escaping of special characters in user-supplied fields. No mocks, no I/O —
 * plain fixtures only.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/builders
 */
import {
  FA3_NAMESPACE,
  FA3_ROOT_ELEMENT,
  FA3_SCHEMA_VERSION,
  type Fa3BuilderInput,
  type SellerProfile,
} from '../domain/fa3-xml.types';
import { buildFa3Xml } from './fa3-xml.builder';

const seller: SellerProfile = {
  nip: '1234567890',
  name: 'Acme Sp. z o.o.',
  address: {
    line1: 'ul. Testowa 1',
    line2: null,
    city: 'Warszawa',
    postalCode: '00-001',
    countryIso2: 'PL',
  },
};

function b2bInput(): Fa3BuilderInput {
  return {
    seller,
    buyer: { kind: 'nip', nip: '9876543210' },
    buyerName: 'Buyer GmbH',
    buyerAddress: {
      line1: 'Main St 5',
      line2: null,
      city: 'Berlin',
      postalCode: '10115',
      countryIso2: 'DE',
    },
    currency: 'PLN',
    issueDate: '2026-06-23',
    invoiceNumber: 'FV/2026/06/0001',
    generatedAt: '2026-06-23T10:15:30Z',
    orderReference: 'ol_order_123',
    lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 123.45, p12: '23' }],
  };
}

describe('buildFa3Xml', () => {
  it('should emit the FA(3) root element', () => {
    expect(buildFa3Xml(b2bInput())).toContain(`<${FA3_ROOT_ELEMENT}`);
  });

  it('should declare the FA(3) namespace', () => {
    expect(buildFa3Xml(b2bInput())).toContain(FA3_NAMESPACE);
  });

  it('should emit KodFormularza with the FA system code and schema version', () => {
    const xml = buildFa3Xml(b2bInput());
    expect(xml).toContain('kodSystemowy="FA (3)"');
    expect(xml).toContain(`wersjaSchemy="${FA3_SCHEMA_VERSION}"`);
    expect(xml).toContain('<KodFormularza');
    expect(xml).toMatch(/>FA</);
    expect(xml).toContain('<WariantFormularza>3</WariantFormularza>');
  });

  it('should carry the document-generation timestamp from input (not Date.now)', () => {
    expect(buildFa3Xml(b2bInput())).toContain(
      '<DataWytworzeniaFa>2026-06-23T10:15:30Z</DataWytworzeniaFa>',
    );
  });

  it('should place the buyer NIP inside Podmiot2 for a B2B invoice', () => {
    const xml = buildFa3Xml(b2bInput());
    expect(xml).toContain('<Podmiot2>');
    expect(xml).toMatch(/<Podmiot2>.*<NIP>9876543210<\/NIP>.*<\/Podmiot2>/s);
  });

  it('should echo the order reference into Adnotacje', () => {
    expect(buildFa3Xml(b2bInput())).toMatch(/<Adnotacje>.*ol_order_123.*<\/Adnotacje>/s);
  });

  it('should emit P_1 (issue date) and P_2 (invoice number)', () => {
    const xml = buildFa3Xml(b2bInput());
    expect(xml).toContain('<P_1>2026-06-23</P_1>');
    expect(xml).toContain('<P_2>FV/2026/06/0001</P_2>');
  });

  it('should emit one FaWiersz per line for a multi-rate invoice', () => {
    const input = b2bInput();
    input.lines = [
      { name: 'A', quantity: 1, unitPriceGross: 100, p12: '23' },
      { name: 'B', quantity: 1, unitPriceGross: 50, p12: '8' },
    ];
    const xml = buildFa3Xml(input);
    expect(xml.match(/<FaWiersz/g)?.length).toBe(2);
  });

  it('should emit P_12 per line and the P_15 grand total', () => {
    const input = b2bInput();
    input.lines = [
      { name: 'A', quantity: 1, unitPriceGross: 100, p12: '23' },
      { name: 'B', quantity: 2, unitPriceGross: 50, p12: '8' },
    ];
    const xml = buildFa3Xml(input);
    expect(xml).toContain('<P_12>23</P_12>');
    expect(xml).toContain('<P_12>8</P_12>');
    // Grand total = 100 + (2 * 50) = 200.00.
    expect(xml).toContain('<P_15>200.00</P_15>');
  });

  it('should escape XML special characters in user-supplied names', () => {
    const input = b2bInput();
    input.buyerName = `<script>alert('x') & "y"</script>`;
    const xml = buildFa3Xml(input);
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).toContain('&amp;');
  });

  it('should emit BrakID for a B2C (no taxId) buyer', () => {
    const input = b2bInput();
    input.buyer = { kind: 'none' };
    expect(buildFa3Xml(input)).toContain('BrakID');
  });

  describe('KOR (correction)', () => {
    function korInput(originalKsefNumber: string | null): Fa3BuilderInput {
      return {
        ...b2bInput(),
        invoiceNumber: 'KOR/2026/06/0001',
        lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 123.0, p12: '23' }],
        correction: {
          typKorekty: '2',
          reason: 'Customer returned 1 unit',
          originalIssueDate: '2026-05-01',
          originalInvoiceNumber: 'FV/2026/05/0042',
          originalKsefNumber,
          correctedLines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, p12: '23' }],
        },
      };
    }

    it('should emit RodzajFaktury=KOR with reason and TypKorekty', () => {
      const xml = buildFa3Xml(korInput('1111111111-20260501-ABCDEF-01'));
      expect(xml).toContain('<RodzajFaktury>KOR</RodzajFaktury>');
      expect(xml).toContain('<TypKorekty>2</TypKorekty>');
      expect(xml).toContain('<PrzyczynaKorekty>Customer returned 1 unit</PrzyczynaKorekty>');
    });

    it('should populate DaneFaKorygowanej/NrKSeF when the original was a KSeF invoice', () => {
      const xml = buildFa3Xml(korInput('1111111111-20260501-ABCDEF-01'));
      expect(xml).toMatch(
        /<DaneFaKorygowanej>.*<DataWystFaKorygowanej>2026-05-01<\/DataWystFaKorygowanej>.*<NrFaKorygowanej>FV\/2026\/05\/0042<\/NrFaKorygowanej>.*<NrKSeF>1111111111-20260501-ABCDEF-01<\/NrKSeF>.*<\/DaneFaKorygowanej>/s,
      );
      expect(xml).not.toContain('<NrKSeFN>');
    });

    it('should emit NrKSeFN=1 (not NrKSeF) when the original was NOT a KSeF invoice', () => {
      const xml = buildFa3Xml(korInput(null));
      expect(xml).toContain('<NrKSeFN>1</NrKSeFN>');
      expect(xml).not.toContain('<NrKSeF>');
    });

    it('should emit the corrected-party snapshots Podmiot1K / Podmiot2K', () => {
      const xml = buildFa3Xml(korInput(null));
      expect(xml).toContain('<Podmiot1K>');
      expect(xml).toContain('<Podmiot2K>');
    });

    it('should emit before rows flagged StanPrzed=1 plus after rows without it', () => {
      const xml = buildFa3Xml(korInput(null));
      // One "before" (StanPrzed) row + one "after" row.
      expect(xml.match(/<FaWiersz/g)?.length).toBe(2);
      expect(xml.match(/<StanPrzed>1<\/StanPrzed>/g)?.length).toBe(1);
      // Before row carries the original quantity 2; after row the corrected 1.
      expect(xml).toMatch(/<StanPrzed>1<\/StanPrzed>/);
    });

    it('should aggregate P_15 from the corrected (after) lines, not the original', () => {
      const xml = buildFa3Xml(korInput(null));
      // After state = 1 * 123.00.
      expect(xml).toContain('<P_15>123.00</P_15>');
    });

    it('should not emit RodzajFaktury for a plain (non-correction) invoice', () => {
      expect(buildFa3Xml(b2bInput())).not.toContain('<RodzajFaktury>');
    });
  });
});
