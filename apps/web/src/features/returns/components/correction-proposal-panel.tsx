/**
 * Credit-Note Correction Proposal Panel (#3090, returns spec § 5.8)
 *
 * Renders the preview — never issues anything. `CorrectionIssuer` is called
 * nowhere here; the panel matches returned lines to the invoice, shows what
 * it found, and hands off to the provider's own correction flow, mounted in
 * a dialog on this page (see the "handoff" note below — #3094 amendment).
 *
 * **A headline before the detail.** The acceptance criterion this shape
 * exists for: an operator must see what is at stake — the total credit and
 * how many lines still need a decision — without scrolling, before reading a
 * single line. The breakdown (automatic / needs your pick / can't credit) is
 * the same three states § 5.8 describes, counted rather than only listed.
 *
 * **Ambiguity is the point, and it must be visible BEFORE the confirm.** The
 * matcher keys on `originalLineNumber`, a 1-based ARRAY POSITION into the
 * issued-line snapshot — so picking a candidate on a price coincidence stamps
 * a line number into a fiscal document that cannot be withdrawn. An
 * `ambiguous` line therefore lists every candidate and selects none; nothing
 * here is a picker an operator clicks — the pick happens on confirm, on the
 * invoice's own correction flow.
 *
 * **`candidatesPriceOrRateDiffer` is evidence, never a tie-break.** Showing
 * that two candidates differ helps the operator choose; choosing for them on
 * that basis would be OpenLinker deciding which invoice line to correct.
 *
 * **A `no-match` line states its reason.** A line excluded silently is the
 * `disposition-not-confirmed` case — a refused restock (#2381) — vanishing
 * without saying so, which is the silent-decline shape this programme keeps
 * closing.
 *
 * **`status: 'ambiguous'` is retired (#3312).** The matcher no longer produces
 * it — the same underlying condition (no single invoice line can be identified
 * automatically) now arrives as `status: 'no-match'` with
 * `noMatchReason: 'ambiguous-invoice-line'`. It must read as attention-worthy
 * here too, not as a routine, closed exclusion, so both the page-level banner
 * and the per-line badge tone treat it exactly like the old `'ambiguous'`
 * status did — see `NEEDS_ATTENTION_NO_MATCH_REASON`, imported from the lib
 * rather than declared here a second time.
 *
 * **The headline is a browser-side estimate with no server counterpart.** A
 * return credits quantity only — core computes no net for a correction and
 * rounds nothing (ADR-063); the provider computes and rounds the actual
 * issued amounts. `RETURN_PROPOSAL_COPY.headlineEstimateNote` says so next to
 * the figure, so it is never read as the number the document will carry.
 *
 * **"Record for review" is not "issue".** The mockup's confirm-dialog CTA
 * reads "Issue credit note", but nothing behind this panel calls
 * `CorrectionIssuer` — the button here only records the ADR-044 change
 * proposal an operator later confirms through the existing correction flow
 * on the invoice page. Labelling it "Issue" here would contradict
 * `RETURN_PROPOSAL_COPY.noAutoIssue` printed one line below it.
 *
 * **Recorded state lives in the query cache, not local state.** A successful
 * record seeds the preview query with the response (#3089), so `changeId`
 * arriving as a prop — sourced from that same cached read — is what survives
 * a re-render or a remount, rather than a `useState` flag this component
 * would lose the moment its parent unmounted it.
 *
 * **The handoff opens the real correction flow, never a link (#3094
 * amendment).** The mockup's own frame-04 gap legend names the
 * `/invoices/:id` link as drift, not a design choice — the operator lands on
 * a page that has to re-derive everything this panel already knows. The
 * fix reuses `sales-document-panel.tsx`'s exact pattern verbatim: resolve
 * the invoice's own `InvoiceRecord` + issuing connection, resolve that
 * connection's provider-specific `InvoiceCorrectionFlow` via `usePlatform`,
 * and mount it in a `Dialog` on this page — no new backend, no new
 * provider logic, and no duplicated correction UI. A provider with no
 * contributed flow (or a stale/disabled issuing connection) degrades to a
 * disabled button rather than a broken dialog.
 *
 * @module apps/web/src/features/returns/components
 */
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/dialog';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { MetricCard } from '../../../shared/ui/metric-card';
import { formatAmount } from '../../../shared/format/format-amount';
import { useToast } from '../../../shared/ui/toast-provider';
import { usePlatform } from '../../../shared/plugins';
import { useConnectionsQuery } from '../../connections';
import {
  resolveIssuingConnection,
  useInvoiceQuery,
  type CorrectionSuggestedLine,
} from '../../invoicing';
import { RETURN_PROPOSAL_COPY } from '../lib/return-proposal.copy';
import {
  computeCorrectionProposalBreakdown,
  lineCredit,
  NEEDS_ATTENTION_NO_MATCH_REASON,
} from '../lib/correction-proposal-breakdown';
import { useRecordCorrectionProposalMutation } from '../hooks/use-record-correction-proposal-mutation';
import type { ReturnCorrectionProposal } from '../api/returns.types';

interface CorrectionProposalPanelProps {
  returnId: string;
  proposal: ReturnCorrectionProposal | null;
  outcome: string;
  /** `null` unless a prior record call (this session or a past one, replayed
   *  through the cache) recorded a change proposal. Always `null` on a fresh
   *  GET preview — see `ReturnCorrectionProposalResponseDto.changeId`. */
  changeId: string | null;
  writeAccess: { canWrite: boolean; demoReadOnly: boolean; visible: boolean };
}

export function CorrectionProposalPanel({
  returnId,
  proposal,
  outcome,
  changeId,
  writeAccess,
}: CorrectionProposalPanelProps): ReactElement {
  const { showToast } = useToast();
  const record = useRecordCorrectionProposalMutation(returnId);
  const [correctionOpen, setCorrectionOpen] = useState(false);

  // Called unconditionally (React hook rules — the early `proposal === null`
  // return below must not skip a hook call). Both degrade to their own
  // disabled/loading query state when there is nothing to resolve yet:
  // `useInvoiceQuery` no-ops on an empty id (`enabled: Boolean(invoiceId)`),
  // and the connections list is needed regardless of which outcome renders.
  const invoiceQuery = useInvoiceQuery(proposal?.invoiceRecordId ?? '');
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  const invoice = invoiceQuery.data ?? null;
  const lock = invoice ? resolveIssuingConnection(invoice, connections) : null;
  const invoicingConnection = lock?.connection ?? null;
  const platform = usePlatform(invoicingConnection?.platformType);
  const InvoiceCorrectionFlow = platform?.invoiceCorrectionFlow ?? null;

  if (proposal === null) {
    const badge = RETURN_PROPOSAL_COPY.outcomeBadges[outcome];
    return (
      <section className="returns-proposal-panel" id="correction">
        <header className="returns-proposal-panel__head">
          <h2 className="section-title">{RETURN_PROPOSAL_COPY.sectionTitle}</h2>
          {/* Each of the 4 non-proposing outcomes gets its own badge — the
              acceptance criterion is that they be DISTINCT, not merely that
              each have some text. An unrecognised outcome renders no badge
              rather than a fabricated one. */}
          {badge !== undefined ? <StatusBadge tone="neutral">{badge}</StatusBadge> : null}
        </header>
        {/* A named outcome, never a blank. An unrecognised one falls through to
            its raw value so an operator can quote it rather than see nothing. */}
        <p className="text-muted">{RETURN_PROPOSAL_COPY.outcomes[outcome] ?? outcome}</p>
        {/* The one outcome with a REAL, reachable remedy on this page — see
            the copy's own note on why the other two get none. */}
        {outcome === 'no-disposed-lines' ? (
          <a href="#custody">{RETURN_PROPOSAL_COPY.recordWhatCameBack}</a>
        ) : null}
      </section>
    );
  }

  const hasAmbiguity = proposal.lines.some(
    (line) =>
      line.status === 'ambiguous' || line.noMatchReason === NEEDS_ATTENTION_NO_MATCH_REASON
  );
  const breakdown = computeCorrectionProposalBreakdown(proposal.lines);
  // Only a `matched` line has both a resolved invoice position and a
  // computed after-correction quantity (#3090) — the grid pre-fills exactly
  // these rows; everything else (ambiguous, no-match) is left for the
  // operator to review on the panel above, never guessed at in the dialog.
  const suggestedLines: CorrectionSuggestedLine[] = proposal.lines.flatMap((line) =>
    line.status === 'matched' &&
    line.selectedOriginalLineNumber !== null &&
    line.newQuantity !== null
      ? [{ originalLineNumber: line.selectedOriginalLineNumber, suggestedQuantity: line.newQuantity }]
      : [],
  );
  const isRecorded = changeId !== null;
  // The picker this AC was written against is retired (#3091) — nothing in
  // this build can resolve an unresolved line (`status: 'ambiguous'`, or its
  // #3312 successor `no-match` / `ambiguous-invoice-line`), so "unresolved"
  // is simply `hasAmbiguity`, permanently, for this proposal.
  const recordDisabled = hasAmbiguity || isRecorded || record.isPending || writeAccess.demoReadOnly;

  return (
    <section className="returns-proposal-panel" id="correction">
      <h2 className="section-title">{RETURN_PROPOSAL_COPY.sectionTitle}</h2>

      {/* Leads the panel: what is at stake, before anything else — the
          headline amount and its breakdown, both above the fold on desktop. */}
      <div className="returns-proposal-panel__summary">
        <MetricCard
          label={RETURN_PROPOSAL_COPY.headlineLabel}
          value={formatAmount(breakdown.totalCredit, proposal.currency)}
          description={RETURN_PROPOSAL_COPY.headlineEstimateNote}
        />
        <dl className="returns-proposal-panel__breakdown">
          <div>
            <dt>{RETURN_PROPOSAL_COPY.breakdownAutomatic}</dt>
            <dd className="tabular">{breakdown.automaticCount}</dd>
          </div>
          <div>
            <dt>{RETURN_PROPOSAL_COPY.breakdownNeedsPick}</dt>
            <dd className="tabular">{breakdown.needsPickCount}</dd>
          </div>
          <div>
            <dt>{RETURN_PROPOSAL_COPY.breakdownCantCredit}</dt>
            <dd className="tabular">{breakdown.cantCreditCount}</dd>
          </div>
        </dl>
      </div>

      <Alert tone="warning">{RETURN_PROPOSAL_COPY.irreversible}</Alert>

      {writeAccess.visible ? (
        <div className="returns-proposal-panel__action">
          <ReadOnlyLock active={writeAccess.demoReadOnly} message={RETURN_PROPOSAL_COPY.readOnly}>
            <Button
              onClick={() => {
                record.mutate(undefined, {
                  onSuccess: () => {
                    showToast({ tone: 'success', description: RETURN_PROPOSAL_COPY.recordSuccess });
                  },
                  onError: () => {
                    showToast({ tone: 'error', description: RETURN_PROPOSAL_COPY.recordError });
                  },
                });
              }}
              disabled={recordDisabled}
            >
              {record.isPending
                ? RETURN_PROPOSAL_COPY.recordPending
                : RETURN_PROPOSAL_COPY.recordAction}
            </Button>
          </ReadOnlyLock>
          {isRecorded ? (
            <StatusBadge tone="success" withDot>
              {RETURN_PROPOSAL_COPY.recordedBadge}
            </StatusBadge>
          ) : null}
          {/* Independent of the button, never folded into its disabled state
              alone (#2100) — a disabled control with no explanation reads as
              broken rather than as "you still have a pick to make". */}
          {!isRecorded && hasAmbiguity ? (
            <span className="text-muted">{RETURN_PROPOSAL_COPY.recordBlockedAmbiguous}</span>
          ) : null}
        </div>
      ) : null}

      {/* The acceptance criterion: a clean and an ambiguous proposal must be
          distinguishable at a glance, before any confirm. Different tone AND
          different sentence — tone alone is not a difference a colour-blind
          operator can read. */}
      <Alert tone={hasAmbiguity ? 'conflict' : 'info'}>
        {hasAmbiguity
          ? RETURN_PROPOSAL_COPY.ambiguousBanner
          : RETURN_PROPOSAL_COPY.cleanBanner}
      </Alert>

      <ul className="returns-proposal-panel__lines">
        {proposal.lines.map((line) => (
          <li className="returns-proposal-line" key={line.returnLineId}>
            <div className="returns-proposal-line__head">
              <span>{line.name ?? line.sku ?? `Line ${line.lineIndex + 1}`}</span>
              <StatusBadge
                compact
                tone={
                  line.status === 'matched'
                    ? 'success'
                    : line.status === 'ambiguous' ||
                        line.noMatchReason === NEEDS_ATTENTION_NO_MATCH_REASON
                      ? 'warning'
                      : 'neutral'
                }
              >
                {/* Plain language, never the raw enum — the issue's own
                    acceptance criterion. */}
                {line.status === 'matched'
                  ? RETURN_PROPOSAL_COPY.statusMatched
                  : line.status === 'ambiguous'
                    ? RETURN_PROPOSAL_COPY.statusAmbiguous
                    : RETURN_PROPOSAL_COPY.statusNoMatch}
              </StatusBadge>
            </div>

            {line.status === 'matched' ? (
              <p className="text-muted tabular">
                {formatAmount(lineCredit(line), proposal.currency)}
              </p>
            ) : null}

            {/* EVERY candidate is listed, and none is preselected. */}
            {line.status === 'ambiguous' ? (
              <>
                <ul className="returns-proposal-line__candidates">
                  {line.candidates.map((candidate) => (
                    <li key={candidate.originalLineNumber}>
                      {candidate.name} — {candidate.quantity} ×{' '}
                      {candidate.unitPriceGross} ({candidate.taxRate})
                    </li>
                  ))}
                </ul>
                {line.candidatesPriceOrRateDiffer ? (
                  <p className="text-muted">{RETURN_PROPOSAL_COPY.candidatesDiffer}</p>
                ) : null}
              </>
            ) : null}

            {/* Excluded lines say WHY. Silence here would hide a refused
                restock's units disappearing from the credit note. */}
            {line.status === 'no-match' ? (
              <p className="text-muted">
                {line.noMatchExplanation ??
                  (line.noMatchReason !== null
                    ? RETURN_PROPOSAL_COPY.noMatchReasons[line.noMatchReason] ??
                      line.noMatchReason
                    : null)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <footer className="returns-proposal-panel__footer text-muted">
        <p>{RETURN_PROPOSAL_COPY.noAutoIssue}</p>
        {/* Reused verbatim from `sales-document-panel.tsx` — the same dialog,
            the same per-provider `InvoiceCorrectionFlow`, no new backend and
            no duplicated correction UI (#3094 amendment). A provider with no
            contributed flow, or a stale/disabled issuing connection,
            degrades to a disabled button with copy explaining why, rather
            than a link that lands on a page unable to help either. */}
        {InvoiceCorrectionFlow && invoice && invoicingConnection ? (
          <>
            <Button
              tone="secondary"
              onClick={() => setCorrectionOpen(true)}
              disabled={lock?.isStale ?? false}
            >
              {RETURN_PROPOSAL_COPY.handoff}
            </Button>
            {lock?.isStale ? (
              <p className="text-muted">{RETURN_PROPOSAL_COPY.handoffConnectionStale}</p>
            ) : null}
            <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
              {/* Wide: the correction-line grid (#3090) is a 5-column table
                  (# / item / as invoiced / after correction / credit) that
                  the default 520px dialog crushes — verified live, the
                  qty×price pair and the reference line both ran together
                  illegibly at that width. */}
              <DialogContent aria-describedby={undefined} className="dialog__content--wide">
                <DialogTitle>{RETURN_PROPOSAL_COPY.handoffDialogTitle}</DialogTitle>
                <InvoiceCorrectionFlow
                  invoice={invoice}
                  connection={invoicingConnection}
                  suggestedLines={suggestedLines}
                  onClose={() => setCorrectionOpen(false)}
                  onCorrectionIssued={() => {
                    setCorrectionOpen(false);
                    void invoiceQuery.refetch();
                  }}
                />
              </DialogContent>
            </Dialog>
          </>
        ) : invoiceQuery.isLoading || connectionsQuery.isLoading ? (
          <p className="text-muted">{RETURN_PROPOSAL_COPY.handoffLoading}</p>
        ) : (
          <p className="text-muted">{RETURN_PROPOSAL_COPY.handoffUnavailable}</p>
        )}
      </footer>
    </section>
  );
}
