/**
 * KsefFa3View tests (#1228)
 *
 * Covers: seller/buyer rendering, invoice lines table, grand total,
 * VAT band summary, KSeF number, and graceful null on unparseable input.
 *
 * @module plugins/ksef/components
 */
import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { KsefFa3View } from './ksef-fa3-view';

// Minimal FA(3) namespace prefix — real documents use `tns:`, but the component
// uses getElementsByTagName(tagName) which matches local names regardless of prefix.
function buildXml({
  sellerName = 'Acme Sp. z o.o.',
  sellerNip = '1234567890',
  buyerName = 'Buyer Corp.',
  buyerNip = '0987654321',
  invoiceNumber = 'FV/2024/001',
  issueDate = '2024-01-15',
  lines = [
    {
      lineNo: '1',
      description: 'Widget A',
      unit: 'pcs',
      quantity: '10',
      netUnitPrice: '100.00',
      netTotal: '1000.00',
      vatRate: '23',
    },
  ],
  vatNet23 = '1000.00',
  vatTax23 = '230.00',
  grandTotal = '1230.00',
  ksefNumber = '20240115-SE-ABCDEF1234',
}: {
  sellerName?: string;
  sellerNip?: string;
  buyerName?: string;
  buyerNip?: string;
  invoiceNumber?: string;
  issueDate?: string;
  lines?: Array<{
    lineNo: string;
    description: string;
    unit: string;
    quantity: string;
    netUnitPrice: string;
    netTotal: string;
    vatRate: string;
  }>;
  vatNet23?: string | null;
  vatTax23?: string | null;
  grandTotal?: string | null;
  ksefNumber?: string | null;
} = {}): string {
  const linesXml = lines
    .map(
      (l) => `
    <FaWiersz>
      <NrWierszaFa>${l.lineNo}</NrWierszaFa>
      <P_7>${l.description}</P_7>
      <P_8A>${l.unit}</P_8A>
      <P_8B>${l.quantity}</P_8B>
      <P_9A>${l.netUnitPrice}</P_9A>
      <P_11>${l.netTotal}</P_11>
      <P_12>${l.vatRate}</P_12>
    </FaWiersz>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${sellerNip}</NIP>
      <NazwaSkrocona>${sellerName}</NazwaSkrocona>
    </DaneIdentyfikacyjne>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>${buyerNip}</NIP>
      <NazwaSkrocona>${buyerName}</NazwaSkrocona>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <Fa>
    <P_1>${invoiceNumber}</P_1>
    <P_2>${issueDate}</P_2>
    ${linesXml}
    ${vatNet23 !== null ? `<P_13_1>${vatNet23}</P_13_1>` : ''}
    ${vatTax23 !== null ? `<P_14_1>${vatTax23}</P_14_1>` : ''}
    ${grandTotal !== null ? `<P_15>${grandTotal}</P_15>` : ''}
  </Fa>
  ${ksefNumber !== null ? `<KSeF><NrKSeF>${ksefNumber}</NrKSeF></KSeF>` : ''}
</Faktura>`;
}

describe('KsefFa3View', () => {
  it('should render seller and buyer names when valid XML is provided', () => {
    renderWithProviders(<KsefFa3View xmlText={buildXml()} />);

    expect(screen.getByText('Acme Sp. z o.o.')).toBeInTheDocument();
    expect(screen.getByText(/1234567890/)).toBeInTheDocument();
    expect(screen.getByText('Buyer Corp.')).toBeInTheDocument();
    expect(screen.getByText(/0987654321/)).toBeInTheDocument();
  });

  it('should render invoice number and issue date when valid XML is provided', () => {
    renderWithProviders(<KsefFa3View xmlText={buildXml()} />);

    expect(screen.getByText('FV/2024/001')).toBeInTheDocument();
    expect(screen.getByText('2024-01-15')).toBeInTheDocument();
  });

  it('should render all invoice lines when valid XML with multiple lines is provided', () => {
    renderWithProviders(
      <KsefFa3View
        xmlText={buildXml({
          lines: [
            {
              lineNo: '1',
              description: 'Widget A',
              unit: 'pcs',
              quantity: '10',
              netUnitPrice: '100.00',
              netTotal: '1000.00',
              vatRate: '23',
            },
            {
              lineNo: '2',
              description: 'Service B',
              unit: 'h',
              quantity: '2',
              netUnitPrice: '50.00',
              netTotal: '100.00',
              vatRate: '8',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Widget A')).toBeInTheDocument();
    expect(screen.getByText('Service B')).toBeInTheDocument();
    // 1000.00 appears in both the lines table (line 1 netTotal) and the VAT band row
    expect(screen.getAllByText('1000.00').length).toBeGreaterThanOrEqual(1);
    // 100.00 appears as netTotal for line 2 and netUnitPrice for line 1
    expect(screen.getAllByText('100.00').length).toBeGreaterThanOrEqual(1);
  });

  it('should show grand total when present in XML', () => {
    renderWithProviders(<KsefFa3View xmlText={buildXml({ grandTotal: '9999.99' })} />);

    expect(screen.getByText('9999.99')).toBeInTheDocument();
  });

  it('should show VAT band net and tax values when present in XML', () => {
    renderWithProviders(
      // Use grand total that won't collide with the tax value in a regex match.
      <KsefFa3View
        xmlText={buildXml({ vatNet23: '1000.00', vatTax23: '230.00', grandTotal: '99.00' })}
      />,
    );

    // VAT net and tax appear in the summary section span text.
    expect(screen.getAllByText(/1000\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/230\.00/).length).toBeGreaterThanOrEqual(1);
  });

  it('should render KSeF assigned number when present in XML', () => {
    renderWithProviders(<KsefFa3View xmlText={buildXml({ ksefNumber: 'KSEF-NUM-123' })} />);

    expect(screen.getByText('KSEF-NUM-123')).toBeInTheDocument();
  });

  it('should return null when XML cannot be parsed', () => {
    const { container } = renderWithProviders(<KsefFa3View xmlText="not xml at all ><>" />);

    // Component returns null — the .ksef-fa3-view root element must not appear.
    expect(container.querySelector('.ksef-fa3-view')).toBeNull();
  });

  it('should return null when invoice number element is missing', () => {
    // Build XML without the P_1 element by using a parseable doc with no invoice number.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura>
  <Fa>
    <P_2>2024-01-15</P_2>
  </Fa>
</Faktura>`;
    const { container } = renderWithProviders(<KsefFa3View xmlText={xml} />);

    // Component returns null — the .ksef-fa3-view root element must not appear.
    expect(container.querySelector('.ksef-fa3-view')).toBeNull();
  });
});
