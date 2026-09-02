/**
 * SalesDocumentMarketRow (#2540/#2542)
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
 * **Detected markets (#2542)**: a market with `orderCount !== null` shows its
 * count *and* the discovery window it was measured over (`windowDays`),
 * because "12 orders" on its own answers "how many" but not "over what
 * period" — an operator needs both to judge whether it's worth acting on.
 * The suggested-setup caption is honest about scope: when this row's
 * `hasTemplate` market is the ONLY one among the rendered rows carrying a
 * template, the caption says so explicitly (`isSoleTemplatedMarket`,
 * computed by the section over every row and passed down) rather than
 * implying every market has guidance. A template-less market never gets a
 * recommendation — its action stays a plain "Set up".
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { DocumentKindGlyph } from '../../../shared/ui/document-kind-glyph';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
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

// #2806 — plain-sentence meta copy, replacing the mono "PL · 0 rules · 3
// orders in the last 30 days" fragment with prose an operator can read
// without decoding a delimiter convention.
function describeMarketMeta(
  row: MarketRowData,
  isDetectedOnly: boolean,
  windowDays?: number,
): string {
  const ruleClause = row.ruleCount === 1 ? '1 rule configured' : `${row.ruleCount} rules configured`;
  if (!isDetectedOnly) return ruleClause;
  const orderClause =
    row.orderCount === 1
      ? windowDays !== undefined
        ? `1 order in the last ${windowDays} days`
        : '1 order'
      : windowDays !== undefined
        ? `${row.orderCount} orders in the last ${windowDays} days`
        : `${row.orderCount} orders`;
  return `${orderClause}, ${ruleClause}`;
}

export interface SalesDocumentMarketRowProps {
  row: MarketRowData;
  /** Fired with the row's country when the action is clicked. */
  onSelect: (country: string) => void;
  /** Disables the action while a mutation/query for this section is in flight (#2543). */
  disabled?: boolean;
  /**
   * The discovery window (in days) the merged read applied, rendered
   * alongside a detected market's order count. Omitted only in contexts
   * (e.g. a standalone render in a test) where the window isn't known.
   */
  windowDays?: number;
  /**
   * True when this row's `hasTemplate` market is the ONLY templated market
   * among the section's rows — changes the suggested-setup caption from a
   * generic "Starter setup available" to one naming the scope explicitly
   * (#2542). Ignored when `row.hasTemplate` is false.
   */
  isSoleTemplatedMarket?: boolean;
}

export function SalesDocumentMarketRow({
  row,
  onSelect,
  disabled = false,
  windowDays,
  isSoleTemplatedMarket = false,
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
        {/* #2806 review — the mockup's status signal is a bare colored dot;
            `StatusBadge` is a full chip (border, background, padding), which
            with no visible text still rendered as a wide pill around one
            tiny dot. A plain dot matches the mockup and is still never the
            only signal — the row's own outcome text/tone carries the rest. */}
        <span
          className={`sales-document-market-row__dot sales-document-market-row__dot--${toneFor(copy)}`}
          aria-hidden="true"
        />
        <span className="sr-only">{copy.needsDecision ? 'Needs attention' : 'Set up'}</span>
      </div>

      <div className="sales-document-market-row__identity">
        <span className="sales-document-market-row__name">{countryLabel(row.country)}</span>
        <span className="sales-document-market-row__meta muted-text">
          {describeMarketMeta(row, isDetectedOnly, windowDays)}
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
            {row.hasTemplate
              ? isSoleTemplatedMarket
                ? ` · Starter setup available — the only market with guidance so far`
                : ' · Starter setup available'
              : ''}
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
