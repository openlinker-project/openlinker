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

/**
 * The sample of the redesigned cards: coffee and tea paid for, a mug given as a
 * gift. The mug's own price (24.90) is the weight "priced in" shares by, and
 * the cap on a custom price: more than that would be worth more than the gift.
 * What the customer paid is 203.98 whatever the form.
 */
export const CARD_SAMPLE_PAID_TOTAL = 203.98;
export const CARD_SAMPLE_GIFT_REFERENCE_PRICE = 24.9;

export interface CardSampleNames {
  coffee: string;
  tea: string;
  mug: string;
}

export function cardSampleLines(names: CardSampleNames, giftUnitPrice?: number): SampleLine[] {
  return [
    { name: names.coffee, quantity: 1, unitPriceGross: 149.99, taxRate: '23' },
    { name: names.tea, quantity: 1, unitPriceGross: 53.99, taxRate: '23' },
    {
      name: names.mug,
      quantity: 1,
      unitPriceGross: 0,
      taxRate: '23',
      isGift: true,
      referenceUnitPriceGross: CARD_SAMPLE_GIFT_REFERENCE_PRICE,
      ...(giftUnitPrice === undefined ? {} : { giftUnitPriceGross: giftUnitPrice }),
    },
  ];
}

/** Parses an operator-typed amount ("2,50" or "2.50"); `null` when it is not a usable one. */
export function parseGiftUnitPrice(text: string): number | null {
  const normalised = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;
  const value = Number(normalised);
  return value > 0 ? value : null;
}
