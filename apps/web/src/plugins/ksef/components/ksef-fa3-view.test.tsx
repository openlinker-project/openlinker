/**
 * KsefFa3View tests (#1228, rebuilt #1526)
 *
 * Fixtures mirror the XML shape emitted by the backend FA(3) builder
 * (`fa3-xml.builder.ts`): P_1 = issue date, P_2 = invoice number, party
 * names in `Nazwa`, addresses in `Adres`, optional `P_6`/`P_8A`/`P_9A`,
 * `Platnosc`, and KOR correction metadata.
 *
 * Covers: P_1/P_2 mapping regression, party name + address rendering,
 * conditional Unit / Net-unit-price columns, per-line gross derivation,
 * VAT band summary with gross, total due with currency, payment section,
 * KOR reason + before-lines separation, and graceful null on bad input.
 *
 * @module plugins/ksef/components
 */
import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { KsefFa3View } from './ksef-fa3-view';

interface FixtureLine {
  lineNo: string;
  description: string;
  unit?: string;
  quantity: string;
  netUnitPrice?: string;
  netTotal: string;
  vatRate: string;
  isBeforeCorrection?: boolean;
}

interface FixtureOptions {
  invoiceNumber?: string;
  issueDate?: string;
  saleDate?: string | null;
  currency?: string;
  invoiceType?: string;
  lines?: FixtureLine[];
  vatNet23?: string | null;
  vatTax23?: string | null;
  grandTotal?: string | null;
  ksefNumber?: string | null;
  correction?: { reason: string; correctedNumber: string } | null;
  payment?: { formCode?: string; termDate?: string; bankAccount?: string } | null;
}

// Builder-produced-like FA(3) XML (default xmlns, no prefix - the component's
// getElementsByTagName lookup is namespace/prefix agnostic anyway).
function buildXml({
  invoiceNumber = 'FV/2026/07/001',
  issueDate = '2026-07-01',
  saleDate = '2026-06-28',
  currency = 'PLN',
  invoiceType = 'VAT',
  lines = [
    {
      lineNo: '1',
      description: 'Widget A',
      unit: 'szt.',
      quantity: '10',
      netUnitPrice: '100.00',
      netTotal: '1000.00',
      vatRate: '23',
    },
  ],
  vatNet23 = '1000.00',
  vatTax23 = '230.00',
  grandTotal = '1230.00',
  ksefNumber = null,
  correction = null,
  payment = null,
}: FixtureOptions = {}): string {
  const linesXml = lines
    .map(
      (l) => `
    <FaWiersz>
      <NrWierszaFa>${l.lineNo}</NrWierszaFa>
      ${l.isBeforeCorrection ? '<StanPrzed>1</StanPrzed>' : ''}
      <P_7>${l.description}</P_7>
      ${l.unit !== undefined ? `<P_8A>${l.unit}</P_8A>` : ''}
      <P_8B>${l.quantity}</P_8B>
      ${l.netUnitPrice !== undefined ? `<P_9A>${l.netUnitPrice}</P_9A>` : ''}
      <P_11>${l.netTotal}</P_11>
      <P_12>${l.vatRate}</P_12>
    </FaWiersz>`,
    )
    .join('');

  const correctionXml = correction
    ? `
    <PrzyczynaKorekty>${correction.reason}</PrzyczynaKorekty>
    <TypKorekty>2</TypKorekty>
    <DaneFaKorygowanej>
      <DataWystFaKorygowanej>2026-06-01</DataWystFaKorygowanej>
      <NrFaKorygowanej>${correction.correctedNumber}</NrFaKorygowanej>
      <NrKSeFN>1</NrKSeFN>
    </DaneFaKorygowanej>`
    : '';

  const paymentXml = payment
    ? `
    <Platnosc>
      ${payment.termDate !== undefined ? `<TerminPlatnosci><Termin>${payment.termDate}</Termin></TerminPlatnosci>` : ''}
      ${payment.formCode !== undefined ? `<FormaPlatnosci>${payment.formCode}</FormaPlatnosci>` : ''}
      ${payment.bankAccount !== undefined ? `<RachunekBankowy><NrRB>${payment.bankAccount}</NrRB></RachunekBankowy>` : ''}
    </Platnosc>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/06251/">
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>1234567890</NIP>
      <Nazwa>Acme Sp. z o.o.</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>ul. Testowa 1</AdresL1>
      <AdresL2>00-001 Warszawa</AdresL2>
    </Adres>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>0987654321</NIP>
      <Nazwa>Buyer Corp.</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>ul. Kupiecka 7</AdresL1>
    </Adres>
  </Podmiot2>
  <Fa>
    <KodWaluty>${currency}</KodWaluty>
    <P_1>${issueDate}</P_1>
    <P_2>${invoiceNumber}</P_2>
    ${saleDate !== null ? `<P_6>${saleDate}</P_6>` : ''}
    ${vatNet23 !== null ? `<P_13_1>${vatNet23}</P_13_1>` : ''}
    ${vatTax23 !== null ? `<P_14_1>${vatTax23}</P_14_1>` : ''}
    ${grandTotal !== null ? `<P_15>${grandTotal}</P_15>` : ''}
    <RodzajFaktury>${invoiceType}</RodzajFaktury>
    ${correctionXml}
    ${linesXml}
    ${paymentXml}
  </Fa>
  ${ksefNumber !== null ? `<KSeF><NrKSeF>${ksefNumber}</NrKSeF></KSeF>` : ''}
</Faktura>`;
}

describe('KsefFa3View', () => {
  describe('full plain invoice', () => {
    it('should render the invoice number from P_2 and the issue date from P_1 (swap regression)', () => {
      renderWithProviders(
        <KsefFa3View
          xmlText={buildXml({ invoiceNumber: 'FV/2026/07/001', issueDate: '2026-07-01' })}
        />,
      );

      // The invoice number is P_2 - the header must show it, not the date.
      expect(screen.getByText('FV/2026/07/001')).toBeInTheDocument();
      expect(screen.getByText('2026-07-01')).toBeInTheDocument();
      const header = document.querySelector('.ksef-fa3-view__doc-number');
      expect(header?.textContent).toBe('FV/2026/07/001');
    });

    it('should render seller and buyer names from Nazwa with NIP and address', () => {
      renderWithProviders(<KsefFa3View xmlText={buildXml()} />);

      expect(screen.getByText('Acme Sp. z o.o.')).toBeInTheDocument();
      expect(screen.getByText('1234567890')).toBeInTheDocument();
      expect(screen.getByText('Buyer Corp.')).toBeInTheDocument();
      expect(screen.getByText('0987654321')).toBeInTheDocument();
      expect(screen.getByText('ul. Testowa 1')).toBeInTheDocument();
      expect(screen.getByText('00-001 Warszawa')).toBeInTheDocument();
      expect(screen.getByText('ul. Kupiecka 7')).toBeInTheDocument();
    });

    it('should render sale date, currency, and the "Standard invoice" subtitle', () => {
      renderWithProviders(<KsefFa3View xmlText={buildXml({ saleDate: '2026-06-28' })} />);

      expect(screen.getByText('Standard invoice')).toBeInTheDocument();
      expect(screen.getByText('2026-06-28')).toBeInTheDocument();
      expect(screen.getByText('Currency')).toBeInTheDocument();
      expect(screen.getByText('PLN')).toBeInTheDocument();
    });

    it('should render Unit and Net unit price columns when lines carry them', () => {
      renderWithProviders(<KsefFa3View xmlText={buildXml()} />);

      expect(screen.getByText('Unit')).toBeInTheDocument();
      expect(screen.getByText('Net unit price')).toBeInTheDocument();
      expect(screen.getByText('szt.')).toBeInTheDocument();
    });

    it('should derive line gross from net and the numeric VAT band and display the rate with %', () => {
      renderWithProviders(<KsefFa3View xmlText={buildXml()} />);

      const mainTable = document.querySelector('.ksef-fa3-view__lines .ksef-fa3-view__table');
      // 1000.00 net * 1.23 = 1230.00 gross
      expect(mainTable?.textContent).toContain('1230.00');
      expect(mainTable?.textContent).toContain('23%');
    });

    it('should render gross = net for a non-numeric VAT band (zw)', () => {
      renderWithProviders(
        <KsefFa3View
          xmlText={buildXml({
            lines: [
              {
                lineNo: '1',
                description: 'Exempt service',
                quantity: '1',
                netTotal: '200.00',
                vatRate: 'zw',
              },
            ],
            vatNet23: null,
            vatTax23: null,
          })}
        />,
      );

      const mainTable = document.querySelector('.ksef-fa3-view__lines .ksef-fa3-view__table');
      const grossCells = mainTable?.textContent?.match(/200\.00/g) ?? [];
      // Net total and gross total both render 200.00.
      expect(grossCells.length).toBeGreaterThanOrEqual(2);
      expect(mainTable?.textContent).toContain('zw');
    });

    it('should render the VAT summary with net, tax, and derived gross per band', () => {
      renderWithProviders(
        <KsefFa3View xmlText={buildXml({ vatNet23: '1000.00', vatTax23: '230.00' })} />,
      );

      const vat = document.querySelector('.ksef-fa3-view__vat');
      expect(vat?.textContent).toContain('1000.00');
      expect(vat?.textContent).toContain('230.00');
      expect(vat?.textContent).toContain('1230.00');
    });

    it('should render the total due with the currency code', () => {
      renderWithProviders(<KsefFa3View xmlText={buildXml({ grandTotal: '1230.00' })} />);

      const total = document.querySelector('.ksef-fa3-view__total');
      expect(total?.textContent).toContain('Total due');
      expect(total?.textContent).toContain('1230.00 PLN');
    });

    it('should render the KSeF assigned number when present', () => {
      renderWithProviders(
        <KsefFa3View xmlText={buildXml({ ksefNumber: '1234567890-20260701-ABCDEF123456-AB' })} />,
      );

      expect(screen.getByText('1234567890-20260701-ABCDEF123456-AB')).toBeInTheDocument();
    });
  });

  describe('minimal legacy document (pre-P_6/P_8A/P_9A backend)', () => {
    const legacyXml = buildXml({
      saleDate: null,
      payment: null,
      lines: [
        {
          lineNo: '1',
          description: 'Legacy item',
          quantity: '2',
          netTotal: '100.00',
          vatRate: '23',
        },
      ],
    });

    it('should hide the Unit and Net unit price columns when no line carries them', () => {
      renderWithProviders(<KsefFa3View xmlText={legacyXml} />);

      expect(screen.queryByText('Unit')).not.toBeInTheDocument();
      expect(screen.queryByText('Net unit price')).not.toBeInTheDocument();
      expect(screen.getByText('Legacy item')).toBeInTheDocument();
    });

    it('should not render the sale date or payment section when absent', () => {
      renderWithProviders(<KsefFa3View xmlText={legacyXml} />);

      expect(screen.queryByText('Sale date')).not.toBeInTheDocument();
      expect(document.querySelector('.ksef-fa3-view__payment')).toBeNull();
    });
  });

  describe('KOR correction', () => {
    const korXml = buildXml({
      invoiceType: 'KOR',
      invoiceNumber: 'FV/2026/07/001/KOR',
      correction: { reason: 'Quantity reduced on line 1', correctedNumber: 'FV/2026/07/001' },
      lines: [
        {
          lineNo: '1',
          description: 'Widget A',
          unit: 'szt.',
          quantity: '10',
          netUnitPrice: '100.00',
          netTotal: '1000.00',
          vatRate: '23',
          isBeforeCorrection: true,
        },
        {
          lineNo: '2',
          description: 'Widget A',
          unit: 'szt.',
          quantity: '5',
          netUnitPrice: '100.00',
          netTotal: '500.00',
          vatRate: '23',
        },
      ],
    });

    it('should show the correction subtitle, reason, and corrected-invoice number', () => {
      renderWithProviders(<KsefFa3View xmlText={korXml} />);

      expect(screen.getByText('Correction invoice')).toBeInTheDocument();
      expect(screen.getByText('Quantity reduced on line 1')).toBeInTheDocument();
      const correction = document.querySelector('.ksef-fa3-view__correction');
      expect(correction?.textContent).toContain('FV/2026/07/001');
    });

    it('should render only the "after" line in the main table with the "before" line collapsed separately (#1364 follow-up)', () => {
      renderWithProviders(<KsefFa3View xmlText={korXml} />);

      const mainTable = document.querySelector('.ksef-fa3-view__lines .ksef-fa3-view__table');
      expect(mainTable?.textContent).toContain('500.00');
      expect(mainTable?.textContent).not.toContain('1000.00');

      expect(screen.getByText('Lines before correction')).toBeInTheDocument();
      const beforeTable = document.querySelector(
        '.ksef-fa3-view__before-correction .ksef-fa3-view__table',
      );
      expect(beforeTable?.textContent).toContain('1000.00');
    });
  });

  describe('payment section', () => {
    it('should map the FormaPlatnosci code to its label and show term date and bank account', () => {
      renderWithProviders(
        <KsefFa3View
          xmlText={buildXml({
            payment: {
              formCode: '6',
              termDate: '2026-07-15',
              bankAccount: '61109010140000071219812874',
            },
          })}
        />,
      );

      expect(screen.getByText('Payment')).toBeInTheDocument();
      expect(screen.getByText('Transfer')).toBeInTheDocument();
      expect(screen.getByText('2026-07-15')).toBeInTheDocument();
      expect(screen.getByText('61109010140000071219812874')).toBeInTheDocument();
    });

    it('should map cash code 1 to the Cash label', () => {
      renderWithProviders(<KsefFa3View xmlText={buildXml({ payment: { formCode: '1' } })} />);

      expect(screen.getByText('Cash')).toBeInTheDocument();
    });
  });

  describe('parse-failure contract', () => {
    it('should return null when XML cannot be parsed', () => {
      const { container } = renderWithProviders(<KsefFa3View xmlText="not xml at all ><>" />);

      expect(container.querySelector('.ksef-fa3-view')).toBeNull();
    });

    it('should return null when the invoice number element (P_2) is missing', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura>
  <Fa>
    <P_1>2026-07-01</P_1>
  </Fa>
</Faktura>`;
      const { container } = renderWithProviders(<KsefFa3View xmlText={xml} />);

      expect(container.querySelector('.ksef-fa3-view')).toBeNull();
    });
  });
});
