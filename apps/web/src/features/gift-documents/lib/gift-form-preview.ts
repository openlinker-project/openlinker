/**
 * Gift form preview (#3941)
 *
 * The sample the settings screens show: a customer pays 100.00 for a book and
 * gets a 20.00 mug as a gift. The document lines come from the mirrored core
 * presenter, so what the operator sees is what a document would say, and the
 * total is checked against what was paid.
 *
 * @module apps/web/src/features/gift-documents/lib
 */
import {
  presentGiftLines,
  type GiftDocumentFormChoice,
  type GiftLineForm,
  type GiftPresentationLine,
} from './gift-lines';

export const SAMPLE_BOOK_PRICE = 100;
export const SAMPLE_MUG_PRICE = 20;
export const SAMPLE_CURRENCY = 'PLN';

export interface SampleLine extends GiftPresentationLine {
  name: string;
}

/** The two sample lines. The book and the mug sit in different VAT rates on purpose. */
export function sampleOrderLines(bookName: string, mugName: string): SampleLine[] {
  return [
    { name: bookName, quantity: 1, unitPriceGross: SAMPLE_BOOK_PRICE, taxRate: '5' },
    {
      name: mugName,
      quantity: 1,
      unitPriceGross: 0,
      taxRate: '23',
      isGift: true,
      referenceUnitPriceGross: SAMPLE_MUG_PRICE,
    },
  ];
}

export interface GiftPreview {
  lines: SampleLine[];
  /** Minor units (grosz), the figure that must equal what was paid. */
  totalMinor: number;
}

export function previewGiftForm(
  lines: readonly SampleLine[],
  form: GiftLineForm | GiftDocumentFormChoice,
  acceptsZeroValueLine: boolean,
): GiftPreview {
  const presented = presentGiftLines(lines, form, acceptsZeroValueLine, {
    currency: SAMPLE_CURRENCY,
  });
  const totalMinor = presented.lines.reduce(
    (sum, line) => sum + line.quantity * Math.round(line.unitPriceGross * 100),
    0,
  );
  return { lines: presented.lines, totalMinor };
}

export function formatMoney(value: number): string {
  return value.toFixed(2);
}
