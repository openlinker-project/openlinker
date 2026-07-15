/**
 * KSeF numbering — configured (resting) view (#1577)
 *
 * The most common state: a main series card and (when a separate correction
 * series is assigned) a correction card, side by side. Each card shows the
 * pattern as a mono chip, the rendered next number large in mono, and a meta
 * row (reset cadence / padding). An info alert states corrections draw from
 * their own series so a corrected invoice never reuses the original number.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import {
  renderInvoiceNumber,
  type NumberingSeries,
} from '../../../features/invoicing';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { RESET_POLICY_LABELS } from './ksef-numbering.schema';

interface KsefNumberingConfiguredProps {
  mainSeries: NumberingSeries;
  correctionSeries: NumberingSeries | null;
  onEditMain: () => void;
  onEditCorrection: (series: NumberingSeries) => void;
}

function nextNumber(series: NumberingSeries): string {
  return renderInvoiceNumber(series.pattern, {
    seq: series.nextSeq,
    seqPadding: series.seqPadding,
    issueDate: new Date(),
  });
}

function metaLine(series: NumberingSeries): string {
  const reset =
    series.resetPolicy === 'none'
      ? 'Never resets'
      : `Resets ${RESET_POLICY_LABELS[series.resetPolicy].toLowerCase()}`;
  const padding = series.seqPadding > 0 ? `Padding ${series.seqPadding}` : 'No padding';
  return `${reset} · ${padding}`;
}

interface SeriesCardProps {
  eyebrow: string;
  series: NumberingSeries;
  onEdit: () => void;
}

function SeriesCard({ eyebrow, series, onEdit }: SeriesCardProps): ReactElement {
  return (
    <div className="numbering-card">
      <div className="numbering-card__header">
        <p className="eyebrow">{eyebrow}</p>
        <span className="numbering-card__pattern mono-text">{series.pattern}</span>
      </div>
      <p className="numbering-card__label">Next invoice number</p>
      <p className="numbering-card__number mono-text tabular">{nextNumber(series)}</p>
      <p className="numbering-card__meta">{metaLine(series)}</p>
      <div className="numbering-card__actions">
        <Button tone="secondary" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

export function KsefNumberingConfigured({
  mainSeries,
  correctionSeries,
  onEditMain,
  onEditCorrection,
}: KsefNumberingConfiguredProps): ReactElement {
  return (
    <div className="numbering-configured">
      <div className="numbering-configured__cards">
        <SeriesCard eyebrow="Main series" series={mainSeries} onEdit={onEditMain} />
        {correctionSeries ? (
          <SeriesCard
            eyebrow="Correction series"
            series={correctionSeries}
            onEdit={() => onEditCorrection(correctionSeries)}
          />
        ) : (
          <div className="numbering-card numbering-card--muted">
            <p className="eyebrow">Correction series</p>
            <p className="numbering-card__label">Shared with main series</p>
            <p className="muted-text">
              Corrections draw their number from the main series. Set up a separate correction
              series from the main card&apos;s editor.
            </p>
          </div>
        )}
      </div>

      <Alert tone="info" title="Corrections keep their own numbers">
        A correcting invoice takes the next number from its correction series, so it never reuses
        the number of the invoice it corrects.
      </Alert>
    </div>
  );
}
