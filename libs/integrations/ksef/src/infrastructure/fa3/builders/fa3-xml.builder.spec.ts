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

  it('should emit RodzajFaktury=VAT for a plain sales invoice', () => {
    expect(buildFa3Xml(b2bInput())).toContain('<RodzajFaktury>VAT</RodzajFaktury>');
  });

  it('should emit the required Adnotacje children with "nothing special" defaults', () => {
    const xml = buildFa3Xml(b2bInput());
    // The five TWybor1_2 flags default to "2" (no).
    expect(xml).toMatch(/<Adnotacje>[^]*<P_16>2<\/P_16>[^]*<\/Adnotacje>/);
    expect(xml).toContain('<P_17>2</P_17>');
    expect(xml).toContain('<P_18>2</P_18>');
    expect(xml).toContain('<P_18A>2</P_18A>');
    expect(xml).toContain('<P_23>2</P_23>');
    // Each choice group takes its negative branch (TWybor1 = "1").
    expect(xml).toContain('<Zwolnienie><P_19N>1</P_19N></Zwolnienie>');
    expect(xml).toContain('<NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>');
    expect(xml).toContain('<PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy>');
  });

  it('should emit Fa children in schema order (P_15 → Adnotacje → RodzajFaktury → FaWiersz)', () => {
    const xml = buildFa3Xml(b2bInput());
    expect(xml).toMatch(/<P_15>[^]*<Adnotacje>[^]*<\/Adnotacje>[^]*<RodzajFaktury>[^]*<FaWiersz/);
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
});
