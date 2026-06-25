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
import { validateFa3Xml } from '../validators/fa3-xsd.validator';

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

    it('should produce a KOR document that passes the structural FA(3) validator', () => {
      // The KOR body must still satisfy the hardened required-section rule set
      // (Naglowek + FA(3) form code, Podmiot1, Fa with KodWaluty/P_1/P_2/
      // RodzajFaktury/Adnotacje and >=1 FaWiersz).
      expect(() => validateFa3Xml(buildFa3Xml(korInput('1111111111-20260501-ABCDEF-01')))).not.toThrow();
    });

    it('should emit RodzajFaktury=KOR with reason and TypKorekty', () => {
      const xml = buildFa3Xml(korInput('1111111111-20260501-ABCDEF-01'));
      expect(xml).toContain('<RodzajFaktury>KOR</RodzajFaktury>');
      expect(xml).toContain('<TypKorekty>2</TypKorekty>');
      expect(xml).toContain('<PrzyczynaKorekty>Customer returned 1 unit</PrzyczynaKorekty>');
    });

    it('should emit the NrKSeF flag + NrKSeFFaKorygowanej pair when the original was a KSeF invoice', () => {
      // XSD (lines ~2910-2928): the KSeF branch of the DaneFaKorygowanej choice is
      // a SEQUENCE — NrKSeF (etd:TWybor1, a FLAG = 1) FOLLOWED BY
      // NrKSeFFaKorygowanej (tns:TNumerKSeF, the actual number). NrKSeF is NOT the
      // number.
      const xml = buildFa3Xml(korInput('1111111111-20260501-ABCDEF-01'));
      expect(xml).toMatch(
        /<DaneFaKorygowanej>.*<DataWystFaKorygowanej>2026-05-01<\/DataWystFaKorygowanej>.*<NrFaKorygowanej>FV\/2026\/05\/0042<\/NrFaKorygowanej>.*<NrKSeF>1<\/NrKSeF>.*<NrKSeFFaKorygowanej>1111111111-20260501-ABCDEF-01<\/NrKSeFFaKorygowanej>.*<\/DaneFaKorygowanej>/s,
      );
      expect(xml).not.toContain('<NrKSeFN>');
    });

    it('should emit NrKSeFN=1 (not the NrKSeF/NrKSeFFaKorygowanej pair) when the original was NOT a KSeF invoice', () => {
      const xml = buildFa3Xml(korInput(null));
      expect(xml).toContain('<NrKSeFN>1</NrKSeFN>');
      expect(xml).not.toContain('<NrKSeF>');
      expect(xml).not.toContain('<NrKSeFFaKorygowanej>');
    });

    it('should NOT emit root-level Podmiot1K / Podmiot2K (XSD nests them in the KOR sequence; OL omits)', () => {
      // The XSD places Podmiot1K/Podmiot2K inside the KOR sequence under Fa
      // (siblings of DaneFaKorygowanej), both minOccurs=0, required only when the
      // party identity itself changed. OL never tracks party changes, so they are
      // omitted entirely — and must never appear at the Faktura root.
      const xml = buildFa3Xml(korInput(null));
      expect(xml).not.toContain('<Podmiot1K>');
      expect(xml).not.toContain('<Podmiot2K>');
    });

    it('should emit before rows flagged StanPrzed=1 plus after rows without it', () => {
      const xml = buildFa3Xml(korInput(null));
      // One "before" (StanPrzed) row + one "after" row.
      expect(xml.match(/<FaWiersz/g)?.length).toBe(2);
      expect(xml.match(/<StanPrzed>1<\/StanPrzed>/g)?.length).toBe(1);
      // Before row carries the original quantity 2; after row the corrected 1.
      expect(xml).toMatch(/<StanPrzed>1<\/StanPrzed>/);
    });

    it('should emit P_15 as the after-minus-before difference, not the after-absolute', () => {
      // FA(3) Fa annotation (XSD line ~2441): on a correcting invoice the
      // tax-base / tax / total-due fields carry the DIFFERENCE (after − before).
      // before = 2 * 123.00 = 246.00; after = 1 * 123.00 = 123.00; diff = −123.00.
      const xml = buildFa3Xml(korInput(null));
      expect(xml).toContain('<P_15>-123.00</P_15>');
      expect(xml).not.toContain('<P_15>123.00</P_15>');
    });

    it('should emit the band aggregates (P_13_1/P_14_1) as the after-minus-before difference', () => {
      // 23% band: before net = 246.00/1.23 = 200.00, vat = 46.00;
      // after net = 123.00/1.23 = 100.00, vat = 23.00; diff net = −100.00, vat = −23.00.
      const xml = buildFa3Xml(korInput(null));
      expect(xml).toContain('<P_13_1>-100.00</P_13_1>');
      expect(xml).toContain('<P_14_1>-23.00</P_14_1>');
    });

    it('should emit RodzajFaktury=VAT (not KOR) for a plain (non-correction) invoice', () => {
      // RodzajFaktury is XSD-required on every FA(3); a plain invoice is `VAT`,
      // and carries none of the KOR-only correction metadata.
      const xml = buildFa3Xml(b2bInput());
      expect(xml).toContain('<RodzajFaktury>VAT</RodzajFaktury>');
      expect(xml).not.toContain('<DaneFaKorygowanej>');
      expect(xml).not.toContain('<PrzyczynaKorekty>');
    });
  });

  describe('VAT-band → P_13/P_14 element mapping', () => {
    function singleLineXml(p12: Fa3BuilderInput['lines'][number]['p12']): string {
      const input = b2bInput();
      input.lines = [{ name: 'Item', quantity: 1, unitPriceGross: 100, p12 }];
      return buildFa3Xml(input);
    }

    it('should map 23% to P_13_1 (net) + P_14_1 (vat)', () => {
      const xml = singleLineXml('23');
      // net = 100 / 1.23 = 81.30; vat = 18.70.
      expect(xml).toContain('<P_13_1>81.30</P_13_1>');
      expect(xml).toContain('<P_14_1>18.70</P_14_1>');
    });

    it('should map 8% to P_13_2 (net) + P_14_2 (vat)', () => {
      const xml = singleLineXml('8');
      // net = 100 / 1.08 = 92.59; vat = 7.41.
      expect(xml).toContain('<P_13_2>92.59</P_13_2>');
      expect(xml).toContain('<P_14_2>7.41</P_14_2>');
    });

    it('should map 5% to P_13_3 (net) + P_14_3 (vat)', () => {
      const xml = singleLineXml('5');
      // net = 100 / 1.05 = 95.24; vat = 4.76.
      expect(xml).toContain('<P_13_3>95.24</P_13_3>');
      expect(xml).toContain('<P_14_3>4.76</P_14_3>');
    });

    it('should map domestic 0% (0 KR) to P_13_6_1 with NO P_14', () => {
      const xml = singleLineXml('0 KR');
      expect(xml).toContain('<P_13_6_1>100.00</P_13_6_1>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should map intra-EU 0% (0 WDT) to P_13_6_2 with NO P_14', () => {
      const xml = singleLineXml('0 WDT');
      expect(xml).toContain('<P_13_6_2>100.00</P_13_6_2>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should map export 0% (0 EX) to P_13_6_3 with NO P_14', () => {
      const xml = singleLineXml('0 EX');
      expect(xml).toContain('<P_13_6_3>100.00</P_13_6_3>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should map exempt (zw) to P_13_7 with NO P_14', () => {
      const xml = singleLineXml('zw');
      expect(xml).toContain('<P_13_7>100.00</P_13_7>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should map not-subject (np) to P_13_8 with NO P_14', () => {
      const xml = singleLineXml('np');
      expect(xml).toContain('<P_13_8>100.00</P_13_8>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should map reverse-charge (oo) to P_13_10 with NO P_14', () => {
      const xml = singleLineXml('oo');
      expect(xml).toContain('<P_13_10>100.00</P_13_10>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should never emit a non-existent synthetic band (e.g. P_13_9 / P_14_6)', () => {
      // P_13_9 / P_14_6 are bands the builder does not populate; the old index
      // scheme accidentally emitted slots like these.
      const xml = singleLineXml('np');
      expect(xml).not.toMatch(/<P_13_9>/);
      expect(xml).not.toMatch(/<P_14_6>/);
    });

    it('should emit P_11 as the line NET, not the gross', () => {
      const xml = singleLineXml('23');
      // gross 100 → net 81.30. The line must carry net, not 100.00.
      expect(xml).toContain('<P_11>81.30</P_11>');
      expect(xml).not.toContain('<P_11>100.00</P_11>');
    });

    it('should keep line P_11 net consistent with the band P_13 net (no drift)', () => {
      const input = b2bInput();
      input.lines = [
        { name: 'A', quantity: 1, unitPriceGross: 100, p12: '23' },
        { name: 'B', quantity: 1, unitPriceGross: 100, p12: '23' },
      ];
      const xml = buildFa3Xml(input);
      // Each line net = 81.30; band aggregate = 162.60.
      expect(xml.match(/<P_11>81\.30<\/P_11>/g)?.length).toBe(2);
      expect(xml).toContain('<P_13_1>162.60</P_13_1>');
    });
  });

  describe('P_8B quantity formatting', () => {
    function qtyXml(quantity: number): string {
      const input = b2bInput();
      input.lines = [{ name: 'Item', quantity, unitPriceGross: 10, p12: '23' }];
      return buildFa3Xml(input);
    }

    it('should render an integer quantity without trailing zeros', () => {
      expect(qtyXml(2)).toContain('<P_8B>2</P_8B>');
    });

    it('should render a fractional quantity to its significant decimals', () => {
      expect(qtyXml(1.5)).toContain('<P_8B>1.5</P_8B>');
    });

    it('should not use exponential notation for a large quantity', () => {
      const xml = qtyXml(1234567890);
      expect(xml).toContain('<P_8B>1234567890</P_8B>');
      expect(xml).not.toMatch(/<P_8B>[^<]*e[+-]/i);
    });
  });
});
