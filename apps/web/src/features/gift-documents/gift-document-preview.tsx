/**
 * GiftDocumentPreview (#3935)
 *
 * A mini document that shows how a gift would sit on an invoice or receipt in a
 * chosen form: two paid lines, the gift line and the total, with the lines the
 * form changed marked and a note that the total is unchanged. The numbers come
 * from the mirrored core presenter, so what the operator sees is what a document
 * would say. Used wherever the operator picks a gift form as cards.
 *
 * @module apps/web/src/features/gift-documents
 */
import type { ReactElement } from 'react';
import { formatAmount } from '../../shared/format/format-amount';
import { useMessages } from '../../shared/i18n';
import {
  parseGiftUnitPrice,
  presentGiftLines,
  type GiftDocumentFormChoice,
  type GiftPresentationLine,
} from './lib/gift-lines';

/** The sample order: two paid lines and one gift worth 24.90 on its own. */
const COFFEE = 149.99;
const TEA = 53.99;
const GIFT_REFERENCE = 24.9;

interface SampleLine extends GiftPresentationLine {
  key: 'coffee' | 'tea' | 'gift';
}

export interface GiftDocumentPreviewProps {
  form: GiftDocumentFormChoice;
  /** Gross unit price for `custom-price`, as typed ("2.50" or "2,50"); ignored for the other forms. */
  customPrice?: string;
  /** Whether the document provider accepts a 0.00 line; `show-zero` falls back to 0.01 without it. */
  acceptsZeroValueLine?: boolean;
  currency?: string;
  className?: string;
}

/** The lines a document would carry, and which of them the form changed. */
export function previewLines(
  form: GiftDocumentFormChoice,
  customPrice: string | undefined,
  acceptsZeroValueLine: boolean,
  currency: string,
): { key: SampleLine['key']; price: number; changed: boolean; gift: boolean }[] {
  const sample: SampleLine[] = [
    { key: 'coffee', quantity: 1, unitPriceGross: COFFEE, taxRate: '23' },
    { key: 'tea', quantity: 1, unitPriceGross: TEA, taxRate: '23' },
    {
      key: 'gift',
      quantity: 1,
      unitPriceGross: 0,
      taxRate: '23',
      isGift: true,
      referenceUnitPriceGross: GIFT_REFERENCE,
      ...(form === 'custom-price' && customPrice !== undefined && parseGiftUnitPrice(customPrice) !== null
        ? { giftUnitPriceGross: parseGiftUnitPrice(customPrice) as number }
        : {}),
    },
  ];
  const presented = presentGiftLines(sample, form, acceptsZeroValueLine, { currency });
  return presented.lines.map((line) => ({
    key: line.key,
    price: line.unitPriceGross,
    gift: line.isGift === true,
    changed: line.isGift !== true && line.unitPriceGross !== (line.key === 'coffee' ? COFFEE : TEA),
  }));
}

export function GiftDocumentPreview({
  form,
  customPrice,
  acceptsZeroValueLine = false,
  currency = 'PLN',
  className,
}: GiftDocumentPreviewProps): ReactElement {
  const copy = useMessages('gift-documents').miniDoc;
  const lines = previewLines(form, customPrice, acceptsZeroValueLine, currency);
  const total = lines.reduce((sum, line) => sum + line.price, 0);
  // Said only when it is true: a form can move the sum (a custom price, a cent
  // where zero is refused), and claiming otherwise would misstate the document.
  const unchanged = Math.round(total * 100) === Math.round((COFFEE + TEA) * 100);
  return (
    <>
      <span className={['pm-doc', className].filter(Boolean).join(' ')} role="img" aria-label={copy.ariaLabel}>
        {lines.map((line) => (
          <span
            key={line.key}
            className={['pm-doc__l', line.gift ? 'is-gift' : '', line.changed ? 'is-chg' : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span>{copy[line.key]}</span>
            <b className="mono tabular">{formatAmount(line.price, undefined)}</b>
          </span>
        ))}
        <span className="pm-doc__l pm-doc__t">
          <span>{copy.total}</span>
          <b className="mono tabular">{formatAmount(total, currency)}</b>
        </span>
      </span>
      {unchanged ? (
        <span className="pm-doc__ok">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8.5l3.2 3.2L13 4.8" />
          </svg>
          {copy.unchanged}
        </span>
      ) : null}
    </>
  );
}
