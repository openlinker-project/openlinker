/**
 * GiftDocumentPreview
 *
 * A small document for the sample order: two paid lines and a mug given as a
 * gift, rendered by the mirrored core presenter, so what the card shows is what
 * a real document would carry. A line the form changed is bold, the gift is in
 * the accent colour, and the total is checked against what was paid, with
 * "Sum unchanged" shown only when it really is.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import type { ReactElement } from 'react';
import { useFormat, useMessages } from '../../../shared/i18n';
import {
  CARD_SAMPLE_PAID_TOTAL,
  cardSampleLines,
  previewGiftForm,
  type SampleLine,
} from '../lib/gift-form-preview';
import type { GiftDocumentFormChoice } from '../lib/gift-lines';

export interface GiftDocumentPreviewProps {
  form: GiftDocumentFormChoice;
  /** The gross price of a `custom-price` gift, a number; ignored for any other form. */
  unitPrice?: number | null;
  /** Whether the provider takes a 0.00 line. The "shown at 0.00" card is previewed as chosen. */
  acceptsZero?: boolean;
  /** Dimmed with its card, for an option that cannot be chosen. */
  className?: string;
}

export function GiftDocumentPreview({
  form,
  unitPrice,
  acceptsZero = true,
  className,
}: GiftDocumentPreviewProps): ReactElement {
  const copy = useMessages('gift-documents');
  const format = useFormat();
  const names = {
    coffee: copy.sample.coffee,
    tea: copy.sample.tea,
    mug: `${copy.sample.mug} ${copy.preview.giftSuffix}`,
  };
  const original = cardSampleLines(names);
  const result = previewGiftForm(
    cardSampleLines(names, unitPrice ?? undefined),
    form,
    acceptsZero,
  );
  const paidBefore = new Map(original.map((line) => [line.name, line.unitPriceGross]));
  const rows = result.lines.map((line: SampleLine) => ({
    name: line.name,
    value: line.unitPriceGross,
    kind:
      line.isGift === true
        ? 'gift'
        : line.unitPriceGross !== paidBefore.get(line.name)
          ? 'changed'
          : 'plain',
  }));
  const unchanged = result.totalMinor === Math.round(CARD_SAMPLE_PAID_TOTAL * 100);
  const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

  return (
    <>
      <span
        className={['gift-doc', className].filter(Boolean).join(' ')}
        role="img"
        aria-label={copy.preview.ariaLabel}
      >
        {rows.map((row) => (
          <span key={row.name} className={`gift-doc__line is-${row.kind}`}>
            <span>{row.name}</span>
            <b>{format.number(row.value, two)}</b>
          </span>
        ))}
        <span className="gift-doc__line gift-doc__total">
          <span>{copy.preview.total}</span>
          <b>{format.money(result.totalMinor / 100, 'PLN')}</b>
        </span>
      </span>
      {unchanged ? (
        <span className="gift-doc__ok">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 6.5 5 9l4.5-5.5" />
          </svg>
          {copy.preview.sumUnchanged}
        </span>
      ) : null}
    </>
  );
}
