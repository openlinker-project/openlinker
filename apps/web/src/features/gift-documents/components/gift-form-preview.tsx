/**
 * GiftFormPreview (#3941)
 *
 * A small receipt and invoice for the sample order (a 100.00 book plus a 20.00
 * mug gift), rendered from the mirrored core presenter so the lines are what a
 * document would carry. The total is shown against what was paid. A receipt
 * always refuses a zero line; the invoice accepts one only where a provider
 * declares it.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import {
  formatMoney,
  previewGiftForm,
  sampleOrderLines,
  SAMPLE_BOOK_PRICE,
  SAMPLE_CURRENCY,
  type SampleLine,
} from '../lib/gift-form-preview';
import type { GiftDocumentFormChoice } from '../lib/gift-lines';

interface GiftFormPreviewProps {
  form: GiftDocumentFormChoice;
  /** Whether a provider accepts a 0.00 line; only the invoice column reads it. */
  zeroAccepted: boolean;
}

function DocumentLines({
  title,
  lines,
  giftSuffix,
  lineTemplate,
  totalLabel,
  totalMinor,
  testId,
}: {
  title: string;
  lines: readonly SampleLine[];
  giftSuffix: string;
  lineTemplate: string;
  totalLabel: string;
  totalMinor: number;
  testId: string;
}): ReactElement {
  return (
    <section className="gift-preview__doc" data-testid={testId}>
      <h4 className="gift-preview__title">{title}</h4>
      <ul className="gift-preview__lines">
        {lines.map((line, index) => (
          <li key={`${line.name}-${index}`} className="gift-preview__line">
            <span>
              {line.name}
              {line.isGift === true ? ` ${giftSuffix}` : ''}
            </span>
            <span className="gift-preview__num">
              {interpolate(lineTemplate, {
                quantity: String(line.quantity),
                price: formatMoney(line.unitPriceGross),
                rate: String(line.taxRate),
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="gift-preview__total">
        <span>{totalLabel}</span>
        <span className="gift-preview__num">
          {formatMoney(totalMinor / 100)} {SAMPLE_CURRENCY}
        </span>
      </p>
    </section>
  );
}

export function GiftFormPreview({ form, zeroAccepted }: GiftFormPreviewProps): ReactElement {
  const copy = useMessages('gift-documents');
  const sample = sampleOrderLines(copy.example.book, copy.example.mugName);
  const receipt = previewGiftForm(sample, form, false);
  const invoice = previewGiftForm(sample, form, zeroAccepted);
  const equalsPaid =
    receipt.totalMinor === SAMPLE_BOOK_PRICE * 100 && invoice.totalMinor === SAMPLE_BOOK_PRICE * 100;

  return (
    <aside
      className="gift-preview"
      aria-label={copy.preview.title}
      data-testid="doc-gift-set-preview"
    >
      <div className="gift-preview__docs" data-testid="doc-gift-set-preview-doc">
        <DocumentLines
          title={copy.preview.receiptTitle}
          lines={receipt.lines}
          giftSuffix={copy.preview.giftSuffix}
          lineTemplate={copy.preview.line}
          totalLabel={copy.preview.total}
          totalMinor={receipt.totalMinor}
          testId="doc-gift-set-receipt"
        />
        <DocumentLines
          title={copy.preview.invoiceTitle}
          lines={invoice.lines}
          giftSuffix={copy.preview.giftSuffix}
          lineTemplate={copy.preview.line}
          totalLabel={copy.preview.total}
          totalMinor={invoice.totalMinor}
          testId="doc-gift-set-invoice"
        />
      </div>
      {equalsPaid ? (
        <p className="muted-text" data-testid="doc-gift-set-preview-sum">
          {copy.preview.equalsPaid}
        </p>
      ) : null}
    </aside>
  );
}
