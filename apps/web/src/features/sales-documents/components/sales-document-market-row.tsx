/**
 * SalesDocumentMarketRow (#2540)
 *
 * One row per market on the settings page's market section — replacing the
 * five-element-per-market stack (eyebrow, two-line sentence, badge, rule
 * count, button) that made country the smallest text on the page. This row
 * puts exactly five things at view, in priority order: a status dot
 * (supplementary — text carries the meaning, never the dot alone), the
 * market name as the visual anchor with its code and rule count demoted to
 * meta text, what an order here gets, the short reason beneath when it gets
 * nothing, and one action labelled for what it actually does.
 *
 * Colour marks exceptions only (epic-wide rule, #2513): an issuing or
 * acknowledged market renders in `neutral`/`success` tone at most, never a
 * loud highlight — only a row that `needsDecision` gets a `warning` dot and
 * an `attention` outline, because only that row is a problem.
 *
 * Below 768px this becomes a card via `.sales-document-market-row` CSS
 * (`index.css`), never a second component — see #2540 acceptance criterion.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { DocumentKindGlyph } from '../../../shared/ui/document-kind-glyph';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import {
  describeSalesDocumentMarketOutcome,
  type SalesDocumentMarketOutcomeCopy,
} from '../lib/sales-document-market-outcome-copy';
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';
import type { SalesDocumentMarketRow as MarketRowData } from '../api/sales-document-markets.types';

function countryLabel(country: string): string {
  return country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY ? '★ Rest of world' : country;
}

function toneFor(copy: SalesDocumentMarketOutcomeCopy): StatusBadgeTone {
  if (copy.needsDecision) return 'warning';
  if (copy.isIssuing) return 'success';
  return 'neutral';
}

function actionLabel(row: MarketRowData, copy: SalesDocumentMarketOutcomeCopy): string {
  if (!copy.needsDecision) return 'Configure';
  return row.hasTemplate ? 'Use starter setup' : 'Set up';
}

export interface SalesDocumentMarketRowProps {
  row: MarketRowData;
  /** Fired with the row's country when the action is clicked. */
  onSelect: (country: string) => void;
  /** Disables the action while a mutation/query for this section is in flight (#2543). */
  disabled?: boolean;
}

export function SalesDocumentMarketRow({
  row,
  onSelect,
  disabled = false,
}: SalesDocumentMarketRowProps): ReactElement {
  const copy = describeSalesDocumentMarketOutcome(row.outcome);
  const isDetectedOnly = row.orderCount !== null;

  return (
    <li
      className={[
        'sales-document-market-row',
        copy.needsDecision ? 'sales-document-market-row--attention' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="sales-document-market-row__status">
        <StatusBadge tone={toneFor(copy)} withDot compact>
          <span className="sr-only">{copy.needsDecision ? 'Needs attention' : 'Set up'}</span>
        </StatusBadge>
      </div>

      <div className="sales-document-market-row__identity">
        <span className="sales-document-market-row__name">{countryLabel(row.country)}</span>
        <span className="sales-document-market-row__meta muted-text mono-text">
          {row.country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY ? 'Catch-all' : row.country} ·{' '}
          {row.ruleCount === 1 ? '1 rule' : `${row.ruleCount} rules`}
          {isDetectedOnly ? ` · ${row.orderCount} orders` : ''}
        </span>
      </div>

      <div className="sales-document-market-row__outcome">
        <div className="sales-document-market-row__outcome-headline">
          <DocumentKindGlyph kind={copy.glyphKind} decorative />
          <span>{copy.headline}</span>
        </div>
        {copy.needsDecision && copy.reasonShort ? (
          <span className="sales-document-market-row__reason muted-text">
            {copy.reasonShort}
            {copy.needsDecision && row.hasTemplate ? ' · Starter setup available' : ''}
          </span>
        ) : null}
      </div>

      <div className="sales-document-market-row__action">
        <Button
          tone={copy.needsDecision ? 'primary' : 'secondary'}
          className="button--sm"
          disabled={disabled}
          onClick={() => onSelect(row.country)}
        >
          {actionLabel(row, copy)}
        </Button>
      </div>
    </li>
  );
}
