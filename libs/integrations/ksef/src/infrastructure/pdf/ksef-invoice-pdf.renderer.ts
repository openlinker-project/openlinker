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

/** One row of the per-rate totals FA(3) states itself (`P_13_x` net, `P_14_x` VAT). */
export interface ParsedRateTotal {
  rate: string;
  net: string;
  vat: string | null;
}

export interface ParsedInvoice {
  number: string;
  issueDate: string;
  currency: string;
  grossTotal: string | null;
  seller: ParsedParty;
  buyer: ParsedParty;
  lines: ParsedLine[];
  rateTotals: ParsedRateTotal[];
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

/**
 * The totals per VAT rate are read, never computed: FA(3) carries them as
 * `P_13_n` (net) and `P_14_n` (VAT), and OpenLinker does not do tax arithmetic.
 * `n` 1-4 are the numeric rates; 6_1 / 7 / 8 are the zero-rated, exempt and
 * not-subject groups, which have no VAT amount.
 */
const RATE_GROUPS: ReadonlyArray<{ net: string; vat: string | null; rate: string }> = [
  { net: 'P_13_1', vat: 'P_14_1', rate: '23%' },
  { net: 'P_13_2', vat: 'P_14_2', rate: '8%' },
  { net: 'P_13_3', vat: 'P_14_3', rate: '5%' },
  { net: 'P_13_4', vat: 'P_14_4', rate: '4%' },
  { net: 'P_13_6_1', vat: null, rate: '0%' },
  { net: 'P_13_7', vat: null, rate: 'zw' },
  { net: 'P_13_8', vat: null, rate: 'np' },
];

const parseRateTotals = (fa: XmlNode): ParsedRateTotal[] =>
  RATE_GROUPS.flatMap((group) => {
    const net = asText(fa[group.net]);
    if (net === null) return [];
    return [{ rate: group.rate, net, vat: group.vat === null ? null : asText(fa[group.vat]) }];
  });

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
    rateTotals: parseRateTotals(fa),
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

const PAGE_WIDTH = 515;
const RIGHT_EDGE = PAGE_MARGIN + PAGE_WIDTH;
const INK = '#111111';
const MUTED = '#555555';
const RULE = '#d0d0d0';
const BAND = '#eef0f3';

/** Amounts are shown to the grosz; the XML OpenLinker sent to KSeF is untouched. */
const formatAmount = (value: string | null): string => {
  if (value === null || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const [whole, fraction] = number.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`;
};

const formatQuantity = (value: string): string => {
  const number = Number(value);
  return Number.isFinite(number) ? String(number).replace('.', ',') : value;
};

const formatRate = (value: string): string => (/^\d+(\.\d+)?$/.test(value) ? `${value}%` : value);

const PARTY_BOX_PADDING = 10;
const PARTY_BOX_WIDTH = 247;

const partyHeight = (doc: PDFKit.PDFDocument, party: ParsedParty): number => {
  const textWidth = PARTY_BOX_WIDTH - 2 * PARTY_BOX_PADDING;
  doc.font(BOLD_FONT).fontSize(11);
  let height = PARTY_BOX_PADDING * 2 + 14 + doc.heightOfString(party.name, { width: textWidth });
  doc.font(REGULAR_FONT).fontSize(9);
  for (const line of party.addressLines) {
    height += doc.heightOfString(line, { width: textWidth });
  }
  if (party.taxId !== null) {
    height += doc.heightOfString(`NIP: ${party.taxId}`, { width: textWidth });
  }
  return height;
};

const writeParty = (
  doc: PDFKit.PDFDocument,
  title: string,
  party: ParsedParty,
  x: number,
  y: number,
  height: number
): void => {
  const textWidth = PARTY_BOX_WIDTH - 2 * PARTY_BOX_PADDING;
  doc.lineWidth(0.7).rect(x, y, PARTY_BOX_WIDTH, height).strokeColor(RULE).stroke();
  const left = x + PARTY_BOX_PADDING;
  doc.font(BOLD_FONT).fontSize(8).fillColor(MUTED).text(title, left, y + PARTY_BOX_PADDING, {
    width: textWidth,
  });
  doc
    .font(BOLD_FONT)
    .fontSize(11)
    .fillColor(INK)
    .text(party.name, left, y + PARTY_BOX_PADDING + 14, { width: textWidth });
  doc.font(REGULAR_FONT).fontSize(9);
  for (const line of party.addressLines) {
    doc.text(line, left, doc.y, { width: textWidth });
  }
  if (party.taxId !== null) {
    doc.text(`NIP: ${party.taxId}`, left, doc.y, { width: textWidth });
  }
};

type Align = 'left' | 'right';

interface Column {
  label: string;
  x: number;
  width: number;
  align: Align;
}

/** Widths leave room for 8-digit amounts and a header that never wraps. */
const COLUMNS: Column[] = [
  { label: 'Lp.', x: PAGE_MARGIN + 6, width: 20, align: 'left' },
  { label: 'Nazwa', x: 70, width: 190, align: 'left' },
  { label: 'Ilość', x: 266, width: 52, align: 'right' },
  { label: 'Cena netto', x: 324, width: 68, align: 'right' },
  { label: 'Wartość netto', x: 398, width: 82, align: 'right' },
  { label: 'VAT', x: 486, width: RIGHT_EDGE - 6 - 486, align: 'right' },
];

const drawTableHeader = (doc: PDFKit.PDFDocument, y: number): number => {
  doc.rect(PAGE_MARGIN, y, PAGE_WIDTH, 22).fill(BAND);
  doc.font(BOLD_FONT).fontSize(8).fillColor(INK);
  for (const column of COLUMNS) {
    doc.text(column.label, column.x, y + 7, {
      width: column.width,
      align: column.align,
      lineBreak: false,
    });
  }
  return y + 22;
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

  // Title block.
  doc
    .font(BOLD_FONT)
    .fontSize(20)
    .fillColor(INK)
    .text(`Faktura ${invoice.number}`, PAGE_MARGIN, PAGE_MARGIN, { width: PAGE_WIDTH });
  doc
    .font(REGULAR_FONT)
    .fontSize(10)
    .fillColor(MUTED)
    .text(`Data wystawienia: ${invoice.issueDate}`, PAGE_MARGIN, 70, { width: PAGE_WIDTH });
  doc.lineWidth(1.5).moveTo(PAGE_MARGIN, 92).lineTo(RIGHT_EDGE, 92).strokeColor(INK).stroke();

  // Parties, side by side in equal boxes.
  const partiesY = 108;
  const boxHeight = Math.max(
    partyHeight(doc, invoice.seller),
    partyHeight(doc, invoice.buyer),
    70
  );
  writeParty(doc, 'SPRZEDAWCA', invoice.seller, PAGE_MARGIN, partiesY, boxHeight);
  writeParty(doc, 'NABYWCA', invoice.buyer, RIGHT_EDGE - PARTY_BOX_WIDTH, partiesY, boxHeight);

  // Lines table.
  let y = drawTableHeader(doc, partiesY + boxHeight + 24);
  doc.font(REGULAR_FONT).fontSize(9).fillColor(INK);
  for (const line of invoice.lines) {
    const quantity =
      line.unit !== null
        ? `${formatQuantity(line.quantity)} ${line.unit}`
        : formatQuantity(line.quantity);
    const cells = [
      line.ordinal,
      line.name,
      quantity,
      formatAmount(line.netUnitPrice),
      formatAmount(line.netValue),
      formatRate(line.rate),
    ];
    const heights = cells.map((cell, index) =>
      doc.heightOfString(cell, { width: COLUMNS[index].width })
    );
    const rowHeight = Math.max(...heights) + 12;
    if (y + rowHeight > 740) {
      doc.addPage();
      y = drawTableHeader(doc, PAGE_MARGIN);
      doc.font(REGULAR_FONT).fontSize(9).fillColor(INK);
    }
    cells.forEach((cell, index) => {
      doc.text(cell, COLUMNS[index].x, y + 6, {
        width: COLUMNS[index].width,
        align: COLUMNS[index].align,
      });
    });
    y += rowHeight;
    doc.lineWidth(0.5).moveTo(PAGE_MARGIN, y).lineTo(RIGHT_EDGE, y).strokeColor(RULE).stroke();
  }

  // Totals per rate, as the invoice states them, then the gross total.
  y += 18;
  if (y + 30 + invoice.rateTotals.length * 18 + 50 > 740) {
    doc.addPage();
    y = PAGE_MARGIN;
  }
  const summary = { rate: 340, net: 392, vat: 472 };
  const vatWidth = RIGHT_EDGE - 6 - summary.vat;
  doc.rect(summary.rate - 6, y, RIGHT_EDGE - summary.rate + 6, 20).fill(BAND);
  doc.font(BOLD_FONT).fontSize(8).fillColor(INK);
  doc.text('Stawka', summary.rate, y + 6, { width: 46, lineBreak: false });
  doc.text('Razem netto', summary.net, y + 6, { width: 74, align: 'right', lineBreak: false });
  doc.text('Kwota VAT', summary.vat, y + 6, { width: vatWidth, align: 'right', lineBreak: false });
  y += 20;
  doc.font(REGULAR_FONT).fontSize(9);
  for (const row of invoice.rateTotals) {
    doc.text(row.rate, summary.rate, y + 5, { width: 46, lineBreak: false });
    doc.text(formatAmount(row.net), summary.net, y + 5, {
      width: 74,
      align: 'right',
      lineBreak: false,
    });
    doc.text(formatAmount(row.vat) || '-', summary.vat, y + 5, {
      width: vatWidth,
      align: 'right',
      lineBreak: false,
    });
    y += 18;
  }
  if (invoice.grossTotal !== null) {
    doc
      .lineWidth(1)
      .moveTo(summary.rate - 6, y + 4)
      .lineTo(RIGHT_EDGE, y + 4)
      .strokeColor(INK)
      .stroke();
    doc
      .font(BOLD_FONT)
      .fontSize(12)
      .fillColor(INK)
      .text(
        `Razem brutto: ${formatAmount(invoice.grossTotal)} ${invoice.currency}`,
        summary.rate - 6,
        y + 12,
        { width: RIGHT_EDGE - summary.rate + 6, align: 'right' }
      );
    y += 36;
  }

  // Verification block: KOD I with the KSeF number as its caption.
  if (y + QR_SIZE + 60 > 780) {
    doc.addPage();
    y = PAGE_MARGIN;
  }
  const qrY = y + 24;
  doc
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, qrY - 12)
    .lineTo(RIGHT_EDGE, qrY - 12)
    .strokeColor(RULE)
    .stroke();
  drawQr(doc, input.verificationUrl, PAGE_MARGIN, qrY);
  doc
    .font(BOLD_FONT)
    .fontSize(8)
    .fillColor(INK)
    .text(input.ksefNumber, PAGE_MARGIN, qrY + QR_SIZE + 6, { width: 300 });
  doc
    .font(BOLD_FONT)
    .fontSize(10)
    .fillColor(INK)
    .text('KOD I', PAGE_MARGIN + QR_SIZE + 18, qrY + 6);
  doc
    .font(REGULAR_FONT)
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      'Zeskanuj kod, aby zweryfikować fakturę w KSeF.',
      PAGE_MARGIN + QR_SIZE + 18,
      qrY + 22,
      { width: 300 }
    );

  doc.end();
  return done;
};
