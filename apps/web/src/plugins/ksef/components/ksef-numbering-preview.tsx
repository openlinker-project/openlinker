/**
 * KSeF numbering live-preview panel
 *
 * The editor's signature surface: renders the next document number large in
 * mono, painting the `{seq}` span in the accent colour and date-derived spans in
 * a secondary tone so the variable→value mapping is legible. Shows a
 * rendered-length meter against the FA(3) `P_2` limit, an ordered "Then" strip
 * of the next numbers, a caption stating the number renders from the invoice's
 * issue date in the seller timezone, and a variable legend. While the pattern is
 * invalid it renders a dash and lists the issues.
 *
 * a11y: only the rendered number + a validity summary sit in the `aria-live`
 * region, so a screen reader re-announces just the number on each keystroke —
 * not the whole panel, caption, and legend.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { buildNumberingPreview, type ResetPolicy } from '../../../features/invoicing';
import {
  FA3_P2_MAX_LENGTH,
  KSEF_TIME_ZONE,
  NUMBERING_VARIABLE_CHIPS,
  VARIABLE_LEGEND,
  resetCaption,
} from './ksef-numbering.lib';

interface KsefNumberingPreviewProps {
  pattern: string;
  nextSeq: string;
  seqPadding: string;
  resetPolicy: ResetPolicy;
}

export function KsefNumberingPreview({
  pattern,
  nextSeq,
  seqPadding,
  resetPolicy,
}: KsefNumberingPreviewProps): ReactElement {
  const parsedSeq = /^\d+$/.test(nextSeq.trim()) ? Number(nextSeq.trim()) : NaN;
  const parsedPadding = /^\d+$/.test(seqPadding.trim()) ? Number(seqPadding.trim()) : 0;
  const preview = buildNumberingPreview({
    pattern,
    nextSeq: parsedSeq,
    seqPadding: parsedPadding,
    resetPolicy,
    now: new Date(),
    timeZone: KSEF_TIME_ZONE,
  });

  const overLimit = preview.renderedLength > FA3_P2_MAX_LENGTH;
  const meterPct = Math.min(100, Math.round((preview.renderedLength / FA3_P2_MAX_LENGTH) * 100));

  return (
    <aside className="numbering-preview">
      <p className="numbering-preview__eyebrow">Live preview</p>
      <p className="numbering-preview__caption-top">Next invoice number</p>

      <div className="numbering-preview__live" aria-live="polite">
        {preview.valid ? (
          <p className="numbering-preview__number mono-text tabular">
            {preview.tokens.map((token, index) => (
              <span
                key={index}
                className={`numbering-preview__token numbering-preview__token--${token.kind}`}
              >
                {token.text}
              </span>
            ))}
          </p>
        ) : (
          <p
            className="numbering-preview__number numbering-preview__number--empty mono-text"
            aria-hidden="true"
          >
            —
          </p>
        )}
        <span className="sr-only">
          {preview.valid
            ? `Renders as ${preview.rendered}${overLimit ? ', over the maximum length' : ''}`
            : 'Pattern is not valid yet'}
        </span>
      </div>

      <p className="numbering-preview__caption">
        Renders from the invoice&apos;s issue date · {KSEF_TIME_ZONE} · {resetCaption(resetPolicy)}
      </p>

      {preview.valid ? (
        <div
          className={`numbering-preview__meter${overLimit ? ' numbering-preview__meter--over' : ''}`}
        >
          <div className="numbering-preview__meter-track" aria-hidden="true">
            <span className="numbering-preview__meter-fill" style={{ width: `${meterPct}%` }} />
          </div>
          <p className="numbering-preview__meter-caption">
            {preview.renderedLength} / {FA3_P2_MAX_LENGTH} characters
            {overLimit ? ' — too long for the KSeF invoice-number field' : ''}
          </p>
        </div>
      ) : null}

      {preview.valid && preview.then.length > 0 ? (
        <div className="numbering-preview__then">
          <p className="numbering-preview__then-label">Then</p>
          <ol className="numbering-preview__then-list">
            {preview.then.map((value) => (
              <li key={value} className="mono-text tabular">
                {value}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {!preview.valid && preview.errors.length > 0 ? (
        <ul className="numbering-preview__errors">
          {preview.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <dl className="numbering-preview__legend">
        {NUMBERING_VARIABLE_CHIPS.map((variable) => (
          <div key={variable} className="numbering-preview__legend-row">
            <dt className="mono-text">{variable}</dt>
            <dd>{VARIABLE_LEGEND[variable]}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
