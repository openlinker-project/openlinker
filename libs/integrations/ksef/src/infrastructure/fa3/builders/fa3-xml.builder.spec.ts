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

  describe('address city/postcode + JST/GV (#1580)', () => {
    it('folds postalCode + city into the buyer AdresL2 (art. 106e ust. 1 pkt 3)', () => {
      const xml = buildFa3Xml(b2bInput());
      // Buyer AdresL1 = street, AdresL2 = "postalCode city" — both now present.
      expect(xml).toContain('<AdresL1>Main St 5</AdresL1>');
      expect(xml).toContain('<AdresL2>10115 Berlin</AdresL2>');
    });

    it('folds seller postalCode + city into the seller AdresL2', () => {
      const xml = buildFa3Xml(b2bInput());
      expect(xml).toContain('<AdresL1>ul. Testowa 1</AdresL1>');
      expect(xml).toContain('<AdresL2>00-001 Warszawa</AdresL2>');
    });

    it('joins a supplementary line2 onto AdresL1 while postcode+city stay on AdresL2', () => {
      const input = b2bInput();
      input.buyerAddress = { ...input.buyerAddress, line2: 'Suite 4' };
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<AdresL1>Main St 5, Suite 4</AdresL1>');
      expect(xml).toContain('<AdresL2>10115 Berlin</AdresL2>');
    });

    it('defaults JST/GV to 2 ("does not apply") when the buyer flags are absent', () => {
      const xml = buildFa3Xml(b2bInput());
      expect(xml).toContain('<JST>2</JST>');
      expect(xml).toContain('<GV>2</GV>');
    });

    it('emits JST=1 when the buyer is flagged a public-sector entity', () => {
      const xml = buildFa3Xml({ ...b2bInput(), buyerIsPublicSectorEntity: true });
      expect(xml).toContain('<JST>1</JST>');
      expect(xml).toContain('<GV>2</GV>');
    });

    it('emits GV=1 when the buyer is flagged a VAT-group member', () => {
      const xml = buildFa3Xml({ ...b2bInput(), buyerIsVatGroupMember: true });
      expect(xml).toContain('<JST>2</JST>');
      expect(xml).toContain('<GV>1</GV>');
    });
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

  describe('Adnotacje classification (#1580)', () => {
    it('keeps the all-negative default for a plain standard-rate invoice', () => {
      const xml = buildFa3Xml(b2bInput());
      expect(xml).toContain('<P_16>2</P_16>');
      expect(xml).toContain('<P_18>2</P_18>');
      expect(xml).toContain('<Zwolnienie><P_19N>1</P_19N></Zwolnienie>');
      expect(xml).toContain('<PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy>');
      expect(() => validateFa3Xml(buildFa3Xml(b2bInput()))).not.toThrow();
    });

    it('emits the PMarzy yes-branch (used-goods sub-kind) when marginScheme is set', () => {
      const xml = buildFa3Xml({ ...b2bInput(), marginScheme: true });
      expect(xml).toContain('<PMarzy><P_PMarzy>1</P_PMarzy><P_PMarzy_3_1>1</P_PMarzy_3_1></PMarzy>');
      expect(xml).not.toContain('<P_PMarzyN>');
      expect(() => validateFa3Xml(buildFa3Xml({ ...b2bInput(), marginScheme: true }))).not.toThrow();
    });

    it('flips the Zwolnienie group to its yes-branch when a line is VAT-exempt (zw)', () => {
      const input: Fa3BuilderInput = {
        ...b2bInput(),
        lines: [{ name: 'Used book', quantity: 1, unitPriceGross: 50, p12: 'zw' }],
      };
      const xml = buildFa3Xml(input);
      expect(xml).toMatch(/<Zwolnienie><P_19>1<\/P_19><P_19C>[^<]+<\/P_19C><\/Zwolnienie>/);
      expect(xml).not.toContain('<P_19N>');
      expect(() => validateFa3Xml(buildFa3Xml(input))).not.toThrow();
    });

    it('carries the operator exemptionLegalBasis text into P_19C', () => {
      const xml = buildFa3Xml({
        ...b2bInput(),
        lines: [{ name: 'Exempt service', quantity: 1, unitPriceGross: 100, p12: 'zw' }],
        exemptionLegalBasis: 'art. 43 ust. 1 pkt 1 ustawy o VAT',
      });
      expect(xml).toContain('<P_19C>art. 43 ust. 1 pkt 1 ustawy o VAT</P_19C>');
    });

    it('sets P_18 (reverse charge) from a line carrying the oo band', () => {
      const input: Fa3BuilderInput = {
        ...b2bInput(),
        lines: [{ name: 'Reverse-charge good', quantity: 1, unitPriceGross: 200, p12: 'oo' }],
      };
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<P_18>1</P_18>');
      expect(() => validateFa3Xml(buildFa3Xml(input))).not.toThrow();
    });

    it('emits each operator flag on its yes-branch when set (P_16/P_17/P_18A/P_23)', () => {
      const input: Fa3BuilderInput = {
        ...b2bInput(),
        cashAccounting: true,
        selfBilling: true,
        splitPayment: true,
        triangulation: true,
      };
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<P_16>1</P_16>');
      expect(xml).toContain('<P_17>1</P_17>');
      expect(xml).toContain('<P_18A>1</P_18A>');
      expect(xml).toContain('<P_23>1</P_23>');
      expect(() => validateFa3Xml(buildFa3Xml(input))).not.toThrow();
    });
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

    it('should sign each band difference independently and net P_15 to their signed sum', () => {
      // A multi-band correction where: the 23% band increases, the 8% band
      // decreases, and an exempt (zw) band is present only in the "before" state
      // (so it reverses to a negative difference and must still surface).
      const input: Fa3BuilderInput = {
        ...b2bInput(),
        invoiceNumber: 'KOR/2026/06/0002',
        lines: [
          { name: 'A', quantity: 1, unitPriceGross: 123.0, p12: '23' }, // before 23%: gross 123
          { name: 'B', quantity: 2, unitPriceGross: 108.0, p12: '8' }, // before 8%: gross 216
          { name: 'C', quantity: 1, unitPriceGross: 100.0, p12: 'zw' }, // before zw: gross 100 (gone after)
        ],
        correction: {
          typKorekty: '2',
          reason: 'Mixed adjustment',
          originalIssueDate: '2026-05-01',
          originalInvoiceNumber: 'FV/2026/05/0043',
          originalKsefNumber: null,
          correctedLines: [
            { name: 'A', quantity: 2, unitPriceGross: 123.0, p12: '23' }, // after 23%: gross 246 (increase)
            { name: 'B', quantity: 1, unitPriceGross: 108.0, p12: '8' }, // after 8%: gross 108 (decrease)
          ],
        },
      };
      const xml = buildFa3Xml(input);
      // 23% net: before 123/1.23=100.00, after 246/1.23=200.00 → diff +100.00; vat diff +23.00.
      expect(xml).toContain('<P_13_1>100.00</P_13_1>');
      expect(xml).toContain('<P_14_1>23.00</P_14_1>');
      // 8% net: before 216/1.08=200.00, after 108/1.08=100.00 → diff −100.00; vat diff −8.00.
      expect(xml).toContain('<P_13_2>-100.00</P_13_2>');
      expect(xml).toContain('<P_14_2>-8.00</P_14_2>');
      // zw present only before (net 100.00) → reverses to −100.00.
      expect(xml).toContain('<P_13_7>-100.00</P_13_7>');
      // P_15 = signed sum of gross diffs: (246−123) + (108−216) + (0−100) = −85.00.
      expect(xml).toContain('<P_15>-85.00</P_15>');
    });

    it('should emit a band that nets to zero as 0.00 (never -0.00)', () => {
      // before 23% gross 123; after 23% gross 123 → the band difference is exactly
      // zero. TKwotowy rejects `-0.00`, so a band that cancels must render `0.00`.
      const input: Fa3BuilderInput = {
        ...b2bInput(),
        invoiceNumber: 'KOR/2026/06/0003',
        lines: [{ name: 'A', quantity: 1, unitPriceGross: 123.0, p12: '23' }],
        correction: {
          typKorekty: '2',
          reason: 'No-op correction',
          originalIssueDate: '2026-05-01',
          originalInvoiceNumber: 'FV/2026/05/0044',
          originalKsefNumber: null,
          correctedLines: [{ name: 'A', quantity: 1, unitPriceGross: 123.0, p12: '23' }],
        },
      };
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<P_13_1>0.00</P_13_1>');
      expect(xml).toContain('<P_14_1>0.00</P_14_1>');
      expect(xml).toContain('<P_15>0.00</P_15>');
      expect(xml).not.toContain('-0.00');
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

    it('should map outside-territory (np I) to P_13_8 with NO P_14', () => {
      const xml = singleLineXml('np I');
      expect(xml).toContain('<P_13_8>100.00</P_13_8>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should map art.100(1)(4) services (np II) to P_13_9 with NO P_14', () => {
      const xml = singleLineXml('np II');
      expect(xml).toContain('<P_13_9>100.00</P_13_9>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should map reverse-charge (oo) to P_13_10 with NO P_14', () => {
      const xml = singleLineXml('oo');
      expect(xml).toContain('<P_13_10>100.00</P_13_10>');
      expect(xml).not.toMatch(/<P_14_/);
    });

    it('should never emit a non-existent synthetic VAT band (e.g. P_14_6)', () => {
      // P_14_6 is a slot the old index scheme accidentally emitted; a net-only
      // band (np I) must carry its P_13_x without any synthetic P_14.
      const xml = singleLineXml('np I');
      expect(xml).not.toMatch(/<P_14_6>/);
      // An np I line must NOT bleed into the np II element.
      expect(xml).not.toMatch(/<P_13_9>/);
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

  describe('Platnosc (#1311)', () => {
    it('should NOT emit Platnosc when input.payment is undefined', () => {
      const xml = buildFa3Xml(b2bInput());
      expect(xml).not.toMatch(/<Platnosc>/);
    });

    it('should emit Platnosc as a sibling of FaWiersz, after it', () => {
      const input = b2bInput();
      input.payment = { formaPlatnosci: '6' };
      const xml = buildFa3Xml(input);
      expect(xml).toMatch(/<\/FaWiersz>[^]*<Platnosc>/);
    });

    it('should emit only FormaPlatnosci when that is the only configured field (Gotówka, no bank account)', () => {
      const input = b2bInput();
      input.payment = { formaPlatnosci: '1' };
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<Platnosc><FormaPlatnosci>1</FormaPlatnosci></Platnosc>');
    });

    it('should emit the full Platnosc block in XSD-mandated child order: TerminPlatnosci, FormaPlatnosci, RachunekBankowy, Skonto', () => {
      const input = b2bInput();
      input.payment = {
        formaPlatnosci: '6',
        bankAccount: { nrRb: '61109010140000000099999999', bankName: 'Santander', swift: 'WBKPPLPP' },
        paymentTermDays: 14,
        skonto: { conditions: '2% if paid within 7 days', amount: '2%' },
      };
      const xml = buildFa3Xml(input);
      expect(xml).toMatch(
        /<Platnosc><TerminPlatnosci>[^]*<\/TerminPlatnosci><FormaPlatnosci>6<\/FormaPlatnosci><RachunekBankowy>[^]*<\/RachunekBankowy><Skonto>[^]*<\/Skonto><\/Platnosc>/,
      );
    });

    it('should emit TerminPlatnosci/TerminOpis with the hardcoded "dni" unit and issue-date starting event', () => {
      const input = b2bInput();
      input.payment = { paymentTermDays: 30 };
      const xml = buildFa3Xml(input);
      expect(xml).toContain(
        '<TerminPlatnosci><TerminOpis><Ilosc>30</Ilosc><Jednostka>dni</Jednostka><ZdarzeniePoczatkowe>data wystawienia faktury</ZdarzeniePoczatkowe></TerminOpis></TerminPlatnosci>',
      );
    });

    it('should emit RachunekBankowy with only NrRB when bankName/swift are absent', () => {
      const input = b2bInput();
      input.payment = { bankAccount: { nrRb: '61109010140000000099999999' } };
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<RachunekBankowy><NrRB>61109010140000000099999999</NrRB></RachunekBankowy>');
    });

    it('should emit RachunekBankowy with NrRB, SWIFT, and NazwaBanku in XSD-mandated order when all are configured', () => {
      const input = b2bInput();
      input.payment = {
        bankAccount: { nrRb: '61109010140000000099999999', bankName: 'Santander', swift: 'WBKPPLPP' },
      };
      const xml = buildFa3Xml(input);
      expect(xml).toContain(
        '<RachunekBankowy><NrRB>61109010140000000099999999</NrRB><SWIFT>WBKPPLPP</SWIFT><NazwaBanku>Santander</NazwaBanku></RachunekBankowy>',
      );
    });

    it('should emit Skonto with WarunkiSkonta and WysokoscSkonta', () => {
      const input = b2bInput();
      input.payment = { skonto: { conditions: '2% if paid within 7 days', amount: '2%' } };
      const xml = buildFa3Xml(input);
      expect(xml).toContain(
        '<Skonto><WarunkiSkonta>2% if paid within 7 days</WarunkiSkonta><WysokoscSkonta>2%</WysokoscSkonta></Skonto>',
      );
    });

    it('should pass the structural FA(3) validator with a fully-configured Platnosc', () => {
      const input = b2bInput();
      input.payment = {
        formaPlatnosci: '6',
        bankAccount: { nrRb: '61109010140000000099999999', bankName: 'Santander', swift: 'WBKPPLPP' },
        paymentTermDays: 14,
        skonto: { conditions: '2% if paid within 7 days', amount: '2%' },
      };
      expect(() => validateFa3Xml(buildFa3Xml(input))).not.toThrow();
    });

    it('should pass the structural FA(3) validator without Platnosc (existing-connection case)', () => {
      expect(() => validateFa3Xml(buildFa3Xml(b2bInput()))).not.toThrow();
    });
  });

  describe('P_6 sale date (#1525)', () => {
    it('should emit P_6 between P_2 and the P_13_x aggregates when saleDate is present', () => {
      const input = b2bInput();
      input.saleDate = '2026-06-20';
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<P_6>2026-06-20</P_6>');
      expect(xml).toMatch(/<P_2>[^]*<\/P_2><P_6>2026-06-20<\/P_6><P_13_1>/);
    });

    it('should emit P_6 even when it equals P_1', () => {
      const input = b2bInput();
      input.saleDate = input.issueDate;
      const xml = buildFa3Xml(input);
      expect(xml).toContain(`<P_6>${input.issueDate}</P_6>`);
    });

    it('should omit P_6 entirely when saleDate is absent', () => {
      expect(buildFa3Xml(b2bInput())).not.toContain('<P_6>');
    });

    it('should pass the structural FA(3) validator with P_6 present', () => {
      const input = b2bInput();
      input.saleDate = '2026-06-20';
      expect(() => validateFa3Xml(buildFa3Xml(input))).not.toThrow();
    });
  });

  describe('P_9A net unit price (#1525)', () => {
    it('should equal P_11 for quantity 1', () => {
      const input = b2bInput();
      input.lines = [{ name: 'A', quantity: 1, unitPriceGross: 123, p12: '23' }];
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<P_9A>100.00</P_9A>');
      expect(xml).toContain('<P_11>100.00</P_11>');
    });

    it('should carry the documented rounding drift for quantity > 1 (net 100.00 / qty 3)', () => {
      const input = b2bInput();
      // gross = 3 x 41 = 123, net = 123 / 1.23 = 100.00; P_9A = 100 / 3 = 33.33
      // so P_9A x P_8B = 99.99 differs from P_11 = 100.00 by a cent - the
      // accepted drift; P_11 stays authoritative.
      input.lines = [{ name: 'A', quantity: 3, unitPriceGross: 41, p12: '23' }];
      const xml = buildFa3Xml(input);
      expect(xml).toContain('<P_9A>33.33</P_9A>');
      expect(xml).toContain('<P_11>100.00</P_11>');
    });

    it('should emit P_9A on KOR before AND after rows with the same formula', () => {
      const input: Fa3BuilderInput = {
        ...b2bInput(),
        lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 123.0, p12: '23' }],
        correction: {
          typKorekty: '2',
          reason: 'Return',
          originalIssueDate: '2026-05-01',
          originalInvoiceNumber: 'FV/2026/05/0042',
          originalKsefNumber: null,
          correctedLines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, p12: '23' }],
        },
      };
      const xml = buildFa3Xml(input);
      // Both rows share the same unit price, so both emit the same P_9A.
      expect(xml.match(/<P_9A>100\.00<\/P_9A>/g)?.length).toBe(2);
    });

    it('should omit P_9A (never emit NaN) for a zero-quantity line', () => {
      const input: Fa3BuilderInput = {
        ...b2bInput(),
        lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, p12: '23' }],
        correction: {
          typKorekty: '2',
          reason: 'Full return',
          originalIssueDate: '2026-05-01',
          originalInvoiceNumber: 'FV/2026/05/0042',
          originalKsefNumber: null,
          // A full return zeroes the "after" row - quantity 0 must not divide
          // P_9A to NaN (KSeF would reject the literal at clearance).
          correctedLines: [{ name: 'Widget', quantity: 0, unitPriceGross: 123.0, p12: '23' }],
        },
      };
      const xml = buildFa3Xml(input);
      expect(xml).not.toContain('NaN');
      // Exactly one P_9A: the "before" row's. The zero-quantity row omits it.
      expect(xml.match(/<P_9A>/g)?.length).toBe(1);
    });
  });

  describe('P_8A unit of measure (#1525)', () => {
    it('should emit P_8A between P_7 and P_8B when the line carries a unit', () => {
      const input = b2bInput();
      input.lines = [{ name: 'Widget', quantity: 2, unitPriceGross: 123.45, p12: '23', unit: 'szt.' }];
      const xml = buildFa3Xml(input);
      expect(xml).toMatch(/<P_7>Widget<\/P_7><P_8A>szt\.<\/P_8A><P_8B>2<\/P_8B>/);
    });

    it('should omit P_8A when the line carries no unit', () => {
      expect(buildFa3Xml(b2bInput())).not.toContain('<P_8A>');
    });

    it('should pass the structural FA(3) validator with P_8A + P_9A present', () => {
      const input = b2bInput();
      input.saleDate = '2026-06-23';
      input.lines = [{ name: 'Widget', quantity: 2, unitPriceGross: 123.45, p12: '23', unit: 'kg' }];
      expect(() => validateFa3Xml(buildFa3Xml(input))).not.toThrow();
    });
  });

  describe('foreign-currency PLN/VAT conversion (art. 106e ust. 11, #1581)', () => {
    function eurMultiBandInput(): Fa3BuilderInput {
      return {
        ...b2bInput(),
        currency: 'EUR',
        saleDate: '2026-06-20',
        lines: [
          { name: 'Standard widget', quantity: 1, unitPriceGross: 123.0, p12: '23' },
          { name: 'Reduced book', quantity: 2, unitPriceGross: 54.0, p12: '8' },
          { name: 'Super-reduced food', quantity: 1, unitPriceGross: 21.0, p12: '5' },
        ],
        exchangeRate: { rate: 4.321, rateDate: '2026-06-19', table: '117/A/NBP/2026' },
      };
    }

    it('should emit KursWaluty (4dp) on every FaWiersz line for a non-PLN invoice', () => {
      const xml = buildFa3Xml(eurMultiBandInput());
      // 3 lines → 3 KursWaluty elements, each the resolved NBP rate at 4dp.
      expect(xml.match(/<KursWaluty>4\.3210<\/KursWaluty>/g)?.length).toBe(3);
    });

    it('should emit the per-band PLN-converted VAT amounts (P_14_xW)', () => {
      const xml = buildFa3Xml(eurMultiBandInput());
      // 23%: VAT 23.00 EUR × 4.3210 = 99.383 → 99.38 PLN
      expect(xml).toContain('<P_14_1>23.00</P_14_1><P_14_1W>99.38</P_14_1W>');
      // 8%: VAT 8.00 EUR × 4.3210 = 34.568 → 34.57 PLN
      expect(xml).toContain('<P_14_2>8.00</P_14_2><P_14_2W>34.57</P_14_2W>');
      // 5%: VAT 1.00 EUR × 4.3210 = 4.321 → 4.32 PLN
      expect(xml).toContain('<P_14_3>1.00</P_14_3><P_14_3W>4.32</P_14_3W>');
    });

    it('should place each P_14_xW immediately after its P_14_x (XSD band order)', () => {
      const xml = buildFa3Xml(eurMultiBandInput());
      expect(xml).toMatch(
        /<P_13_1>[^<]*<\/P_13_1><P_14_1>[^<]*<\/P_14_1><P_14_1W>[^<]*<\/P_14_1W>/,
      );
    });

    it('should pass the structural FA(3) validator for a multi-band non-PLN invoice', () => {
      expect(() => validateFa3Xml(buildFa3Xml(eurMultiBandInput()))).not.toThrow();
    });

    it('should emit KursWaluty + P_14_xW on a foreign-currency correction (converted difference)', () => {
      const input = eurMultiBandInput();
      input.correction = {
        typKorekty: '2',
        reason: 'Return',
        originalIssueDate: '2026-06-20',
        originalInvoiceNumber: 'FV/2026/06/0001',
        originalKsefNumber: null,
        // After: the 23% line quantity drops to 0 (full return of that line).
        correctedLines: [
          { name: 'Standard widget', quantity: 0, unitPriceGross: 123.0, p12: '23' },
          { name: 'Reduced book', quantity: 2, unitPriceGross: 54.0, p12: '8' },
          { name: 'Super-reduced food', quantity: 1, unitPriceGross: 21.0, p12: '5' },
        ],
      };
      const xml = buildFa3Xml(input);
      // 23% band VAT difference: 0 − 23.00 = −23.00 EUR × 4.3210 = −99.38 PLN.
      expect(xml).toContain('<P_14_1>-23.00</P_14_1><P_14_1W>-99.38</P_14_1W>');
      expect(xml).toContain('<KursWaluty>4.3210</KursWaluty>');
      expect(() => validateFa3Xml(xml)).not.toThrow();
    });

    it('should NOT emit KursWaluty or P_14_xW for a PLN invoice', () => {
      const xml = buildFa3Xml(b2bInput());
      expect(xml).not.toContain('<KursWaluty>');
      expect(xml).not.toContain('P_14_1W');
    });
  });
});
