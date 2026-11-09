/**
 * GiftFormExampleTable (#3941)
 *
 * The worked example under the default choice: what the book and the mug come
 * to on a document in each of the four forms.
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
  SAMPLE_MUG_PRICE,
} from '../lib/gift-form-preview';
import { GiftDocumentFormChoiceValues } from '../lib/gift-lines';
import { useGiftFormLabels } from '../lib/use-gift-form-labels';

export function GiftFormExampleTable(): ReactElement {
  const copy = useMessages('gift-documents');
  const labels = useGiftFormLabels();
  const sample = sampleOrderLines(copy.example.book, copy.example.mugName);

  return (
    <div className="gift-example">
      <h3 className="section-title">{copy.example.title}</h3>
      <p className="muted-text">
        {interpolate(copy.example.intro, {
          total: formatMoney(SAMPLE_BOOK_PRICE),
          book: formatMoney(SAMPLE_BOOK_PRICE),
          mug: formatMoney(SAMPLE_MUG_PRICE),
        })}
      </p>
      <table className="data-table" data-testid="doc-gift-set-example">
        <caption className="sr-only">{copy.example.caption}</caption>
        <thead>
          <tr>
            <th>{copy.example.form}</th>
            <th className="gift-example__num">{copy.example.book}</th>
            <th className="gift-example__num">{copy.example.mug}</th>
          </tr>
        </thead>
        <tbody>
          {GiftDocumentFormChoiceValues.map((form) => {
            const { lines } = previewGiftForm(sample, form, true);
            const book = lines.find((line) => line.isGift !== true);
            const mug = lines.find((line) => line.isGift === true);
            return (
              <tr key={form}>
                <td>{labels.short(form)}</td>
                <td className="gift-example__num">{book ? formatMoney(book.unitPriceGross) : ''}</td>
                <td className="gift-example__num">
                  {mug ? formatMoney(mug.unitPriceGross) : copy.example.noLine}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
