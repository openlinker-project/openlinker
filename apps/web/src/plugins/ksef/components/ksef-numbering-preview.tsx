/**
 * KSeF numbering live-preview panel (#1577)
 *
 * The editor's signature surface: renders the next document number large in
 * mono, painting the `{seq}` span in the accent colour and date-derived spans
 * in a secondary tone so the variable→value mapping is legible. Shows an
 * ordered "Then" strip of the next three numbers (numbering is a sequence, so
 * the ordered ghost list is meaningful), a caption describing the reset
 * cadence, and a variable legend. While the pattern is invalid it renders a
 * dash instead of a fabricated number and lists the issues.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { buildNumberingPreview, type ResetPolicy } from '../../../features/invoicing';
import { NUMBERING_VARIABLE_CHIPS, RESET_POLICY_LABELS } from './ksef-numbering.schema';

interface KsefNumberingPreviewProps {
  pattern: string;
  nextSeq: string;
  seqPadding: string;
  resetPolicy: ResetPolicy;
}

const VARIABLE_LEGEND: Record<(typeof NUMBERING_VARIABLE_CHIPS)[number], string> = {
  '{seq}': 'Sequence number',
  '{YYYY}': '4-digit year',
  '{YY}': '2-digit year',
  '{MM}': 'Month 01-12',
  '{QQ}': 'Quarter 1-4',
};

function resetCaption(resetPolicy: ResetPolicy): string {
  return resetPolicy === 'none'
    ? 'never resets'
    : `resets ${RESET_POLICY_LABELS[resetPolicy].toLowerCase()}`;
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
  });

  return (
    <aside className="numbering-preview" aria-live="polite">
      <p className="numbering-preview__eyebrow">Live preview</p>
      <p className="numbering-preview__caption-top">Next invoice number</p>

      {preview.valid ? (
        <p className="numbering-preview__number mono-text tabular">
          {preview.tokens.map((token, index) => (
            <span key={index} className={`numbering-preview__token numbering-preview__token--${token.kind}`}>
              {token.text}
            </span>
          ))}
        </p>
      ) : (
        <p className="numbering-preview__number numbering-preview__number--empty mono-text" aria-hidden="true">
          —
        </p>
      )}

      <p className="numbering-preview__caption">
        Renders from today&apos;s date · {resetCaption(resetPolicy)}
      </p>

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
