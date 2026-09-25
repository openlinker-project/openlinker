/**
 * Credit-Note Proposal Panel (#2382, returns spec § 5.8)
 *
 * **A proposal, never an issue.** Nothing here calls `CorrectionIssuer`; the
 * panel matches returned lines to the invoice, renders what it found, and hands
 * off to the provider's own correction flow on `/invoices/:invoiceId`. The
 * footer says so, because a reader should not have to infer it from the absence
 * of a button.
 *
 * **Ambiguity is the point, and it must be visible BEFORE the confirm.** The
 * matcher keys on `originalLineNumber`, a 1-based ARRAY POSITION into the
 * issued-line snapshot — so picking a candidate on a price coincidence stamps a
 * line number into a fiscal document that cannot be withdrawn. An `ambiguous`
 * line therefore lists every candidate and selects none, and the panel renders a
 * banner that differs from the clean case at a glance rather than only per row.
 *
 * **`candidatesPriceOrRateDiffer` is evidence, never a tie-break.** Showing that
 * two candidates differ helps the operator choose; choosing for them on that
 * basis would be OpenLinker deciding which invoice line to correct.
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
 * status did — see `NEEDS_ATTENTION_NO_MATCH_REASON` below.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { RETURN_PROPOSAL_COPY } from '../lib/return-proposal.copy';
import type { ReturnCorrectionProposal } from '../api/returns.types';

interface ReturnProposalPanelProps {
  proposal: ReturnCorrectionProposal | null;
  outcome: string;
}

/**
 * The one `noMatchReason` value that must read as attention-worthy rather than
 * as a routine, closed exclusion — the residual case `status: 'ambiguous'`
 * used to carry before #3312 retired it. Named once so the banner check and
 * the badge-tone check below cannot drift.
 */
const NEEDS_ATTENTION_NO_MATCH_REASON = 'ambiguous-invoice-line';

export function ReturnProposalPanel({
  proposal,
  outcome,
}: ReturnProposalPanelProps): ReactElement {
  if (proposal === null) {
    return (
      <section className="returns-proposal-panel" id="correction">
        <h2 className="section-title">{RETURN_PROPOSAL_COPY.sectionTitle}</h2>
        {/* A named outcome, never a blank. An unrecognised one falls through to
            its raw value so an operator can quote it rather than see nothing. */}
        <p className="text-muted">{RETURN_PROPOSAL_COPY.outcomes[outcome] ?? outcome}</p>
      </section>
    );
  }

  const hasAmbiguity = proposal.lines.some(
    (line) =>
      line.status === 'ambiguous' || line.noMatchReason === NEEDS_ATTENTION_NO_MATCH_REASON
  );

  return (
    <section className="returns-proposal-panel" id="correction">
      <h2 className="section-title">{RETURN_PROPOSAL_COPY.sectionTitle}</h2>

      {/* Leads the panel: what is at stake, before anything else. */}
      <Alert tone="warning">{RETURN_PROPOSAL_COPY.irreversible}</Alert>

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
                {line.status === 'matched'
                  ? RETURN_PROPOSAL_COPY.statusMatched
                  : line.status === 'ambiguous'
                    ? RETURN_PROPOSAL_COPY.statusAmbiguous
                    : RETURN_PROPOSAL_COPY.statusNoMatch}
              </StatusBadge>
            </div>

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
        {/* A route link, never a reimplementation — the provider's own
            correction flow is mounted on the invoice page. */}
        <Link to={`/invoices/${proposal.invoiceRecordId}`}>
          {RETURN_PROPOSAL_COPY.handoff}
        </Link>
      </footer>
    </section>
  );
}
