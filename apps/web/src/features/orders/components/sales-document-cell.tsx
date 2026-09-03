/**
 * Sales-Document Cell (#2552/#2553, ADR-065)
 *
 * The line inside the money cluster where a hardcoded `+ Issue invoice`
 * button used to sit (`OrderInvoicingCell`, retired by this component). One
 * line at any state: a kind glyph, one word for the most actionable fact, a
 * tick when finished, a quiet pulsing dot while in flight, and a count badge
 * when a second record exists for the order. Clicking it opens a popover with
 * the identity facts, the persisted reason, a duplicate warning, and the
 * available action.
 *
 * Colour marks exceptions only (mini-epic #2551 acceptance criteria) — a
 * finished document renders in the same ink as an in-flight one; only a
 * `warning` / `error` tone tints the line. The word itself carries the
 * actionable fact (`resolveSalesDocumentCellState`), so colour is never the
 * only signal.
 *
 * The popover reuses the M5 `Popover` primitive (`shared/ui/popover.tsx`),
 * which renders into a portal at the document root specifically so a
 * cell-anchored panel is never clipped by the table's `overflow-x: auto`
 * container (#2553 acceptance criteria) — no positioning code lives here.
 * `dismissOnViewportChange` is on: the row this popover describes is no
 * longer where the operator is looking once the table scrolls.
 *
 * Shared verbatim between the desktop cell and the mobile card, the same
 * discipline `OrderInvoicingCell` established, so the two cannot drift.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import { DocumentKindGlyph, type DocumentKind } from '../../../shared/ui/document-kind-glyph';
import { resolveSalesDocumentCellState } from '../lib/sales-document-cell-state';
import type { SalesDocumentView } from '../api/orders.types';

export interface SalesDocumentCellProps {
  internalOrderId: string;
  /** `undefined` (row predates this field or the batch found nothing) and a
   *  null `documentKind` inside it render identically — see the resolver. */
  view: SalesDocumentView | undefined;
  /**
   * `stack` lets the parent's `orders-cell-stack` lay the money-cluster lines
   * out vertically (desktop); `row` widens the popover for the mobile card's
   * narrower trigger column. Layout only.
   */
  layout: 'stack' | 'row';
  /**
   * Whether ANY connection exposes the capability this order's kind needs.
   * When none does, the action is withheld — offering it would dead-end the
   * same way the retired `OrderInvoicingCell`'s CTA did (#1713).
   */
  hasIssuingCapability: boolean;
  /**
   * connectionId → display name, so a duplicate-record warning or the
   * Provider fact never renders a raw UUID to the operator
   * (`frontend-ui-style-guide.md` § `EntityLabel`, #2761 review). Falls back
   * to the id only when the connection is unknown to this lookup.
   */
  connectionNames: Map<string, string>;
}

function isKnownDocumentKind(kind: string | null): kind is DocumentKind {
  return kind === 'invoice' || kind === 'fiscal-receipt';
}

/** Reuses the shared M5 primitive rather than a second glyph set (#2552 review). */
function DocumentGlyph({ kind }: { kind: string | null }): ReactNode {
  return (
    <DocumentKindGlyph
      kind={isKnownDocumentKind(kind) ? kind : null}
      decorative
      className="sales-doc__glyph"
    />
  );
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

/** Human-readable kind label — never a platform/provider name (that lives on `providerType`). */
const KIND_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  'fiscal-receipt': 'Fiscal receipt',
};

/** The action's own label, distinct per kind (mirrors the mockup's `c` map). */
const ACTION_LABEL: Record<string, string> = {
  invoice: 'Issue invoice',
  'fiscal-receipt': 'Register receipt',
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

function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="sales-doc-fact">
      <span className="sales-doc-fact__label">{label}</span>
      <span className="sales-doc-fact__value">{children}</span>
    </div>
  );
}

export function SalesDocumentCell({
  internalOrderId,
  view,
  layout,
  hasIssuingCapability,
  connectionNames,
}: SalesDocumentCellProps): ReactNode {
  const state = resolveSalesDocumentCellState(view);
  const otherRecords = view?.otherRecords ?? [];
  const dupeCount = otherRecords.length;
  const kindLabel = state.kind ? (KIND_LABEL[state.kind] ?? state.kind) : 'No document';
  // An action renders only when this order's kind still needs one AND some
  // connection can issue it — offering a dead-end action is worse than none.
  const showAction = state.keepsAction && state.kind !== null && hasIssuingCapability;
  const actionLabel = state.kind ? (ACTION_LABEL[state.kind] ?? 'Open') : null;

  // A `title` an operator can hover, and the SAME sentence in the trigger's
  // `aria-label` below - `aria-label` on the button overrides everything inside
  // it, so an `sr-only` span in here would be unreachable and a duplicate
  // record would be invisible to a screen reader (#2761 review).
  const dupeSentence =
    dupeCount === 0
      ? null
      : dupeCount === 1
        ? 'A second document exists for this order'
        : `${dupeCount + 1} documents exist for this order`;

  // With nothing routed, `kindLabel` and the word are the same sentence - say it
  // once rather than "No document: No document".
  const redundantKindLabel = kindLabel === state.word;
  const headline = redundantKindLabel ? state.word : `${kindLabel} · ${state.word}`;
  const spokenState = redundantKindLabel ? state.word : `${kindLabel}: ${state.word}`;

  const line = (
    <span className={`sales-doc sales-doc--${state.tone}`}>
      <DocumentGlyph kind={state.kind} />
      <span className="sales-doc__word">{state.word}</span>
      {state.tone === 'done' ? <TickIcon /> : null}
      {state.tone === 'progress' ? <span className="sales-doc__live" aria-hidden="true" /> : null}
      {dupeSentence ? (
        <span className="sales-doc__dupe" title={dupeSentence}>
          {dupeCount + 1}
        </span>
      ) : null}
    </span>
  );

  const identity = view?.document?.identity ?? null;
  const regulatoryStatus =
    view?.document?.kind === 'invoice' ? view.document.regulatoryStatus : null;

  const popoverBody = (
    <>
      {state.reasonDetail ? <p className="sales-doc-popover__why">{state.reasonDetail}</p> : null}
      {view?.blockDetail ? <p className="sales-doc-popover__why">{view.blockDetail}</p> : null}
      {identity?.documentNumber ? <Fact label="Number">{identity.documentNumber}</Fact> : null}
      {identity?.connectionId ? (
        <Fact label="Provider">
          {/* Name-first, provider type as a qualifier (#2761 review) — on a
              multi-connection install "which connection issued this" is the
              useful fact, and the duplicate-record warning right below it
              already names connections rather than provider types. */}
          {connectionNames.get(identity.connectionId) ?? identity.connectionId}
          {identity.providerType ? ` (${identity.providerType})` : ''}
        </Fact>
      ) : null}
      {regulatoryStatus ? (
        <Fact label="Clearance">
          <span className={`sales-doc-tone sales-doc-tone--${REGULATORY_TONE[regulatoryStatus] ?? 'neutral'}`}>
            {REGULATORY_LABEL[regulatoryStatus] ?? regulatoryStatus}
          </span>
        </Fact>
      ) : null}
      {dupeCount > 0 ? (
        <p className="sales-doc-popover__warn">
          {otherRecords.map((r) => connectionNames.get(r.connectionId) ?? r.connectionId).join(', ')}{' '}
          {dupeCount === 1 ? 'also holds' : 'also hold'} a document for this sale. One sale
          should have one document.
        </p>
      ) : null}
    </>
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
      <PopoverContent
        align="start"
        className={`sales-doc-popover${layout === 'row' ? ' sales-doc-popover--row' : ''}`}
      >
        <div className="sales-doc-popover__head">
          <span className={`sales-doc sales-doc--${state.tone}`}>
            <DocumentGlyph kind={state.kind} />
            <span className="sales-doc__word">{headline}</span>
          </span>
        </div>
        <div className="sales-doc-popover__body">{popoverBody}</div>
        <div className="sales-doc-popover__foot">
          <Link className="orders-row-cta" to={`/orders/${internalOrderId}#invoicing`}>
            Open order
          </Link>
          {showAction && actionLabel ? (
            <Link className="orders-row-cta" to={`/orders/${internalOrderId}#invoicing`}>
              <span className="orders-row-cta__plus" aria-hidden="true">
                +
              </span>{' '}
              {actionLabel}
            </Link>
          ) : null}
          {state.kind === null ? (
            <Link className="orders-row-cta" to="/settings/sales-documents">
              Set routing
            </Link>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
