/**
 * Sales-Document List Cell (#3307)
 *
 * The Status column of the merged /sales-documents list. Reinstates the
 * `/orders` row's popover pattern (`SalesDocumentCell`) — reversed into this
 * design after user feedback that the mockup's status word felt hollow with
 * nothing to click: a scan-heavy list needs the same quick-glance identity
 * popover `/orders` already has, not just a coloured word.
 *
 * Unlike `SalesDocumentCell`, every row here ALWAYS carries a `document` —
 * a merged-list row is a record-driven read (#3306), so there is no
 * "routing decided, nothing issued yet" branch, no `otherRecords` full list
 * (only a count), and no "Issue…" action to offer (issuing lives on the
 * per-order panel, not this cross-order list).
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import { DocumentKindGlyph, type DocumentKind } from '../../../shared/ui/document-kind-glyph';
import { resolveSalesDocumentRecordWord } from '../lib/resolve-sales-document-record-word';
import type { SalesDocumentRecordView } from '../../orders';

export interface SalesDocumentListCellProps {
  orderId: string;
  document: SalesDocumentRecordView;
  /** How many OTHER connections hold a record for this same order (ADR-041). */
  otherRecordCount: number;
  /** connectionId → display name; falls back to the raw id when unknown. */
  connectionNames: Map<string, string>;
}

const KIND_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  'fiscal-receipt': 'Fiscal receipt',
};

const REGULATORY_TONE: Record<string, 'success' | 'info' | 'error' | 'neutral'> = {
  accepted: 'success',
  cleared: 'success',
  submitted: 'info',
  'pending-submission': 'info',
  rejected: 'error',
  'not-applicable': 'neutral',
};

const REGULATORY_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  cleared: 'Clearing',
  submitted: 'Submitted',
  'pending-submission': 'Awaiting submission',
  rejected: 'Rejected',
  'not-applicable': 'N/A',
};

function isKnownDocumentKind(kind: string): kind is DocumentKind {
  return kind === 'invoice' || kind === 'fiscal-receipt';
}

/**
 * The invoice detail page still lives at `/invoices/:invoiceId` (its own
 * param name and every existing deep link) — reusing it verbatim rather than
 * widening its route/params for one new caller. A fiscal receipt has no
 * pre-existing detail route, so it gets the new `/sales-documents/...` one.
 */
function documentHref(document: SalesDocumentRecordView): string {
  return document.kind === 'invoice'
    ? `/invoices/${document.identity.recordId}`
    : `/sales-documents/fiscal-receipt/${document.identity.recordId}`;
}

function TickIcon(): ReactNode {
  return (
    <svg className="sales-doc__tick" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M2.5 6.4 4.7 8.6 9.5 3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="sales-doc-fact">
      <span className="sales-doc-fact__label">{label}</span>
      <span className="sales-doc-fact__value">{children}</span>
    </div>
  );
}

export function SalesDocumentListCell({
  orderId,
  document,
  otherRecordCount,
  connectionNames,
}: SalesDocumentListCellProps): ReactNode {
  const { word, tone } = resolveSalesDocumentRecordWord(document);
  const kind = document.kind;
  const kindLabel = KIND_LABEL[kind] ?? kind;
  const identity = document.identity;
  const regulatoryStatus = document.kind === 'invoice' ? document.regulatoryStatus : null;
  const failureReason = document.failureReason;

  const dupeSentence =
    otherRecordCount === 0
      ? null
      : otherRecordCount === 1
        ? 'A second document exists for this order'
        : `${otherRecordCount + 1} documents exist for this order`;

  const redundantKindLabel = kindLabel === word;
  const headline = redundantKindLabel ? word : `${kindLabel} · ${word}`;
  const spokenState = redundantKindLabel ? word : `${kindLabel}: ${word}`;

  const line = (
    <span className={`sales-doc sales-doc--${tone}`}>
      <DocumentKindGlyph
        kind={isKnownDocumentKind(kind) ? kind : null}
        decorative
        className="sales-doc__glyph"
      />
      <span className="sales-doc__word">{word}</span>
      {tone === 'done' ? <TickIcon /> : null}
      {tone === 'progress' ? <span className="sales-doc__live" aria-hidden="true" /> : null}
      {dupeSentence ? (
        <span className="sales-doc__dupe" title={dupeSentence}>
          {otherRecordCount + 1}
        </span>
      ) : null}
    </span>
  );

  return (
    <Popover dismissOnViewportChange>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="sales-doc-trigger"
          aria-label={dupeSentence ? `${spokenState}. ${dupeSentence}` : spokenState}
        >
          {line}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="sales-doc-popover">
        <div className="sales-doc-popover__head">
          <span className={`sales-doc sales-doc--${tone}`}>
            <DocumentKindGlyph
              kind={isKnownDocumentKind(kind) ? kind : null}
              decorative
              className="sales-doc__glyph"
            />
            <span className="sales-doc__word">{headline}</span>
          </span>
        </div>
        <div className="sales-doc-popover__body">
          {failureReason ? <p className="sales-doc-popover__why">{failureReason}</p> : null}
          {identity.documentNumber ? <Fact label="Number">{identity.documentNumber}</Fact> : null}
          <Fact label="Provider">
            {connectionNames.get(identity.connectionId) ?? identity.connectionId}
            {identity.providerType ? ` (${identity.providerType})` : ''}
          </Fact>
          {regulatoryStatus ? (
            <Fact label="Clearance">
              <span
                className={`sales-doc-tone sales-doc-tone--${REGULATORY_TONE[regulatoryStatus] ?? 'neutral'}`}
              >
                {REGULATORY_LABEL[regulatoryStatus] ?? regulatoryStatus}
              </span>
            </Fact>
          ) : null}
          {dupeSentence ? <p className="sales-doc-popover__warn">{dupeSentence}.</p> : null}
        </div>
        <div className="sales-doc-popover__foot">
          <Link className="orders-row-cta" to={`/orders/${orderId}#invoicing`}>
            Open order
          </Link>
          <Link className="orders-row-cta" to={documentHref(document)}>
            View document →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
