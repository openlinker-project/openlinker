/**
 * KSeF invoice PDF renderer (#3620, D30)
 *
 * Builds the human-readable PDF of an FA(3) invoice from the XML OpenLinker
 * submitted: seller, buyer, lines, the gross total, the KSeF number and the
 * KOD I verification QR. KSeF itself returns XML only, while a marketplace
 * order, an email and the pack bench all need a document a person can open.
 *
 * Pure and deterministic: a function of its input alone, no I/O beyond pdfkit reading
 * the two bundled fonts. The same invoice renders to the same bytes - the
 * `CreationDate` and the PDF file id both derive from the invoice's own issue
 * date, never from the clock - so a re-render never looks like a different
 * document.
 *
 * It only renders a CLEARED invoice: the caller passes the KSeF number and the
 * KOD I url, and a document that does not have both yet is refused upstream
 * rather than rendered with a placeholder where the legal element belongs.
 * KOD II (the certificate-signed offline code) is deliberately not drawn - see
 * `libs/integrations/ksef/docs/setup-guide.md`.
 *
 * @module libs/integrations/ksef/src/infrastructure/pdf
 */
import { join } from 'path';
import PDFDocument from 'pdfkit';
import qrcode from 'qrcode-generator';
import { XMLParser } from 'fast-xml-parser';

export interface KsefInvoicePdfInput {
  /** The exact FA(3) XML that was submitted. */
  xml: string;
  /** The KSeF number the authority assigned (the QR's caption). */
  ksefNumber: string;
  /** The KOD I verification url, built by the adapter from the persisted hash. */
  verificationUrl: string;
}

export interface ParsedParty {
  name: string;
  taxId: string | null;
  addressLines: string[];
}

export interface ParsedLine {
  ordinal: string;
  name: string;
  unit: string | null;
  quantity: string;
  netUnitPrice: string | null;
  netValue: string;
  rate: string;
}

export interface ParsedInvoice {
  number: string;
  issueDate: string;
  currency: string;
  grossTotal: string | null;
  seller: ParsedParty;
  buyer: ParsedParty;
  lines: ParsedLine[];
}

const FONT_DIR = join(__dirname, 'fonts');
const REGULAR_FONT = join(FONT_DIR, 'DejaVuSans.ttf');
const BOLD_FONT = join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const PAGE_MARGIN = 40;
const QR_SIZE = 110;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name): boolean => name === 'FaWiersz',
});

type XmlNode = Record<string, unknown>;

const asNode = (value: unknown): XmlNode =>
  typeof value === 'object' && value !== null ? (value as XmlNode) : {};

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const parseParty = (podmiot: XmlNode): ParsedParty => {
  const identity = asNode(podmiot['DaneIdentyfikacyjne']);
  const address = asNode(podmiot['Adres']);
  return {
    name: asText(identity['Nazwa']) ?? '',
    taxId: asText(identity['NIP']) ?? asText(identity['NrID']),
    addressLines: [asText(address['AdresL1']), asText(address['AdresL2'])].filter(
      (line): line is string => line !== null
    ),
  };
};

export const parseInvoice = (xml: string): ParsedInvoice => {
  const root = asNode(asNode(parser.parse(xml))['Faktura']);
  const fa = asNode(root['Fa']);
  const rows = Array.isArray(fa['FaWiersz']) ? (fa['FaWiersz'] as unknown[]) : [];
  return {
    number: asText(fa['P_2']) ?? '',
    issueDate: asText(fa['P_1']) ?? '',
    currency: asText(fa['KodWaluty']) ?? '',
    grossTotal: asText(fa['P_15']),
    seller: parseParty(asNode(root['Podmiot1'])),
    buyer: parseParty(asNode(root['Podmiot2'])),
    lines: rows.map((row) => {
      const line = asNode(row);
      return {
        ordinal: asText(line['NrWierszaFa']) ?? '',
        name: asText(line['P_7']) ?? '',
        unit: asText(line['P_8A']),
        quantity: asText(line['P_8B']) ?? '',
        netUnitPrice: asText(line['P_9A']),
        netValue: asText(line['P_11']) ?? '',
        rate: asText(line['P_12']) ?? '',
      };
    }),
  };
};

/** Draw the QR as filled squares - the module matrix is the whole symbol. */
const drawQr = (doc: PDFKit.PDFDocument, url: string, x: number, y: number): void => {
  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const cell = QR_SIZE / count;
  doc.fillColor('#000000');
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        doc.rect(x + col * cell, y + row * cell, cell, cell).fill();
      }
    }
  }
};

const writeParty = (
  doc: PDFKit.PDFDocument,
  title: string,
  party: ParsedParty,
  x: number,
  y: number
): void => {
  doc.font(BOLD_FONT).fontSize(9).fillColor('#555555').text(title, x, y);
  doc
    .font(BOLD_FONT)
    .fontSize(11)
    .fillColor('#000000')
    .text(party.name, x, y + 14, { width: 240 });
  doc.font(REGULAR_FONT).fontSize(9);
  for (const line of party.addressLines) {
    doc.text(line, { width: 240 });
  }
  if (party.taxId !== null) {
    doc.text(`NIP: ${party.taxId}`, { width: 240 });
  }
};

/**
 * Render the invoice. Returns the PDF bytes.
 *
 * @throws Error when the XML carries no `Faktura` root - the caller hands over
 *   the persisted submitted document, so that is a corrupt record, not input.
 */
export const renderKsefInvoicePdf = (input: KsefInvoicePdfInput): Promise<Uint8Array> => {
  const invoice = parseInvoice(input.xml);
  if (invoice.number === '' && invoice.lines.length === 0) {
    return Promise.reject(new Error('The stored source document is not an FA(3) invoice'));
  }

  // The invoice's own issue date, never the clock: byte-stable by construction.
  const fixedDate = new Date(`${invoice.issueDate || '1970-01-01'}T00:00:00Z`);
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    info: {
      Title: `Faktura ${invoice.number}`,
      Producer: 'OpenLinker',
      Creator: 'OpenLinker',
      CreationDate: fixedDate,
      ModDate: fixedDate,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', reject);
  });

  doc
    .font(BOLD_FONT)
    .fontSize(18)
    .fillColor('#000000')
    .text(`Faktura ${invoice.number}`, PAGE_MARGIN, PAGE_MARGIN);
  doc.font(REGULAR_FONT).fontSize(10).text(`Data wystawienia: ${invoice.issueDate}`);

  writeParty(doc, 'SPRZEDAWCA', invoice.seller, PAGE_MARGIN, 110);
  writeParty(doc, 'NABYWCA', invoice.buyer, 310, 110);

  // Lines table.
  let y = 220;
  const columns = [
    { label: 'Lp.', x: PAGE_MARGIN, width: 24 },
    { label: 'Nazwa', x: 66, width: 230 },
    { label: 'Ilość', x: 300, width: 56 },
    { label: 'Cena netto', x: 358, width: 64 },
    { label: 'Wartość netto', x: 424, width: 70 },
    { label: 'VAT', x: 496, width: 40 },
  ];
  doc.font(BOLD_FONT).fontSize(9);
  for (const column of columns) {
    doc.text(column.label, column.x, y, { width: column.width });
  }
  y += 16;
  doc
    .moveTo(PAGE_MARGIN, y - 4)
    .lineTo(555, y - 4)
    .strokeColor('#999999')
    .stroke();

  doc.font(REGULAR_FONT).fontSize(9);
  for (const line of invoice.lines) {
    if (y > 700) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    const quantity = line.unit !== null ? `${line.quantity} ${line.unit}` : line.quantity;
    const cells = [
      line.ordinal,
      line.name,
      quantity,
      line.netUnitPrice ?? '',
      line.netValue,
      line.rate,
    ];
    const heights = cells.map((cell, index) =>
      doc.heightOfString(cell, { width: columns[index].width })
    );
    cells.forEach((cell, index) => {
      doc.text(cell, columns[index].x, y, { width: columns[index].width });
    });
    y += Math.max(...heights) + 6;
  }

  if (invoice.grossTotal !== null) {
    doc
      .font(BOLD_FONT)
      .fontSize(11)
      .text(`Razem brutto: ${invoice.grossTotal} ${invoice.currency}`, PAGE_MARGIN, y + 10, {
        width: 515,
        align: 'right',
      });
    y += 34;
  }

  // Verification block: KOD I with the KSeF number as its caption.
  if (y > 640) {
    doc.addPage();
    y = PAGE_MARGIN;
  }
  const qrY = y + 20;
  drawQr(doc, input.verificationUrl, PAGE_MARGIN, qrY);
  doc
    .font(BOLD_FONT)
    .fontSize(8)
    .fillColor('#000000')
    .text(input.ksefNumber, PAGE_MARGIN, qrY + QR_SIZE + 4, {
      width: 260,
    });
  doc
    .font(REGULAR_FONT)
    .fontSize(9)
    .text('KOD I', PAGE_MARGIN + QR_SIZE + 16, qrY + 4);
  doc
    .fontSize(8)
    .fillColor('#555555')
    .text('Zeskanuj kod, aby zweryfikować fakturę w KSeF.', PAGE_MARGIN + QR_SIZE + 16, qrY + 20, {
      width: 300,
    });

  doc.end();
  return done;
};
