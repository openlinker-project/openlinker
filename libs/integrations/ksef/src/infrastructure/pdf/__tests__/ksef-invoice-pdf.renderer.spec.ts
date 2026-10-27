/**
 * KSeF invoice PDF renderer tests (#3620)
 *
 * The renderer is pure, so every assertion is on its input/output: the parsed
 * FA(3) fields, the PDF envelope, and - the property the issue names - that the
 * same invoice renders to the same bytes.
 */
import { parseInvoice, renderKsefInvoicePdf } from '../ksef-invoice-pdf.renderer';

const FA3_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Podmiot1>
    <DaneIdentyfikacyjne><NIP>1234567890</NIP><Nazwa>Zażółć Sp. z o.o.</Nazwa></DaneIdentyfikacyjne>
    <Adres><KodKraju>PL</KodKraju><AdresL1>ul. Łąkowa 1</AdresL1><AdresL2>00-001 Łódź</AdresL2></Adres>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne><NIP>9876543210</NIP><Nazwa>Gęślą Jaźń S.A.</Nazwa></DaneIdentyfikacyjne>
    <Adres><KodKraju>PL</KodKraju><AdresL1>ul. Różana 2</AdresL1><AdresL2>00-002 Warszawa</AdresL2></Adres>
  </Podmiot2>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>2026-02-01</P_1>
    <P_2>FV/2026/02/0001</P_2>
    <P_15>123.00</P_15>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa><P_7>Kubek ceramiczny</P_7><P_8A>szt.</P_8A><P_8B>2</P_8B>
      <P_9A>50.00</P_9A><P_11>100.00</P_11><P_12>23</P_12>
    </FaWiersz>
  </Fa>
</Faktura>`;

const KSEF_NUMBER = '1234567890-20260201-0100001AF629-AF';
const URL = 'https://qr.ksef.mf.gov.pl/invoice/1234567890/01-02-2026/abc';

describe('parseInvoice', () => {
  it('should read the parties, header and lines from the namespaced FA(3) document', () => {
    const invoice = parseInvoice(FA3_XML);

    expect(invoice.number).toBe('FV/2026/02/0001');
    expect(invoice.issueDate).toBe('2026-02-01');
    expect(invoice.currency).toBe('PLN');
    expect(invoice.grossTotal).toBe('123.00');
    expect(invoice.seller).toEqual({
      name: 'Zażółć Sp. z o.o.',
      taxId: '1234567890',
      addressLines: ['ul. Łąkowa 1', '00-001 Łódź'],
    });
    expect(invoice.buyer.name).toBe('Gęślą Jaźń S.A.');
    expect(invoice.lines).toEqual([
      {
        ordinal: '1',
        name: 'Kubek ceramiczny',
        unit: 'szt.',
        quantity: '2',
        netUnitPrice: '50.00',
        netValue: '100.00',
        rate: '23',
      },
    ]);
  });

  it('should read a single-line invoice as a one-element list, not a bare object', () => {
    expect(parseInvoice(FA3_XML).lines).toHaveLength(1);
  });
});

describe('renderKsefInvoicePdf', () => {
  it('should produce a PDF document', async () => {
    const bytes = await renderKsefInvoicePdf({
      xml: FA3_XML,
      ksefNumber: KSEF_NUMBER,
      verificationUrl: URL,
    });

    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('should render the same invoice to identical bytes', async () => {
    const input = { xml: FA3_XML, ksefNumber: KSEF_NUMBER, verificationUrl: URL };

    const first = await renderKsefInvoicePdf(input);
    const second = await renderKsefInvoicePdf(input);

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('should draw a different symbol for a different verification url', async () => {
    const a = await renderKsefInvoicePdf({
      xml: FA3_XML,
      ksefNumber: KSEF_NUMBER,
      verificationUrl: URL,
    });
    const b = await renderKsefInvoicePdf({
      xml: FA3_XML,
      ksefNumber: KSEF_NUMBER,
      verificationUrl: 'https://qr-test.ksef.mf.gov.pl/invoice/1234567890/01-02-2026/abc',
    });

    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('should refuse a document that is not an FA(3) invoice', async () => {
    await expect(
      renderKsefInvoicePdf({ xml: '<Other/>', ksefNumber: KSEF_NUMBER, verificationUrl: URL })
    ).rejects.toThrow('not an FA(3) invoice');
  });
});
