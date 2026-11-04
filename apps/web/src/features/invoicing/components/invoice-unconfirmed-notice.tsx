/**
 * Invoice Unconfirmed Notice (#3766)
 *
 * The whole in-doubt state in one notification: what happened, the two
 * steps that finish it (each with its own action beside it), and what stays
 * paused and why. Replaces the connection-lock box + inline alert + loose
 * action row, which said the same thing three times in three shapes.
 *
 * Deliberately QUIET: it is the only content of the slot, so a full
 * warning-soft fill would turn the whole panel into one brown slab while the
 * headline already says "Unconfirmed" in warning colour. Warning tone lives
 * in the stripe, the glyph and the step numbers only.
 *
 * Renders the `.alert` markup directly (same classes, same role) instead of
 * the `Alert` primitive, because it needs its own header row - `Alert`'s
 * `title` is a bare <strong> with no room for the attempt time.
 *
 * @module apps/web/src/features/invoicing/components
 */
import { useState, type ReactElement } from 'react';

import { getMessages, interpolate, renderRich, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { FailureCode } from '../api/invoicing.types';

export interface InvoiceUnconfirmedNoticeProps {
  connectionName: string;
  failureCode: FailureCode | null;
  /** The record's last write - when OpenLinker last heard anything. */
  attemptedAt: string | null;
  /** PII-free sanitized provider text, shown verbatim behind a disclosure. */
  providerResponse: string | null;
  onCheckProvider: () => void;
  /** Absent until a backend endpoint exists: step 2 and its confirm are then not rendered. */
  onMarkResolved?: () => void;
}

export function InvoiceUnconfirmedNotice({
  connectionName,
  failureCode,
  attemptedAt,
  providerResponse,
  onCheckProvider,
  onMarkResolved,
}: InvoiceUnconfirmedNoticeProps): ReactElement {
  const copy = useMessages('invoicing').invoice.inDoubt;
  // "Mark resolved" asserts something OpenLinker cannot verify, so a stray
  // click must not be enough: it opens a confirm with focus on "Not yet".
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Only a timeout can honestly say "did not answer in time"; a provider that
  // answered without settling the question must not be described as silent.
  const cause = interpolate(resolveCause(failureCode), { connection: connectionName });

  return (
    <div className="alert alert--warning invoice-unconfirmed" role="status" data-testid="invoice-unconfirmed">
      <div className="invoice-unconfirmed__body">
        <div className="invoice-unconfirmed__head">
          <svg className="invoice-unconfirmed__glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M8 2.2 14.3 13.3H1.7z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M8 6.6v3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r="0.8" fill="currentColor" />
          </svg>
          <strong className="invoice-unconfirmed__title">
            {copy.title}
          </strong>
          {attemptedAt ? (
            <TimeDisplay iso={attemptedAt} format="datetime" className="invoice-unconfirmed__time mono-text" />
          ) : null}
        </div>
        <p className="invoice-unconfirmed__cause">
          {cause} {copy.maybe}
        </p>

        <ol className="invoice-unconfirmed__steps" aria-label={copy.stepsLabel}>
          <li className="invoice-unconfirmed__step">
            <span className="invoice-unconfirmed__n" aria-hidden="true">1</span>
            <span className="invoice-unconfirmed__text">
              {renderRich(
                copy.step1,
                { b: (chunk) => <strong>{chunk}</strong> },
                { connection: connectionName },
              )}
            </span>
            <Button tone="secondary" className="button--sm invoice-unconfirmed__action" onClick={onCheckProvider}>
              {copy.check}
            </Button>
          </li>
          {onMarkResolved ? (
          <li className="invoice-unconfirmed__step">
            <span className="invoice-unconfirmed__n" aria-hidden="true">2</span>
            <span className="invoice-unconfirmed__text">
              {copy.step2}
            </span>
            <Button tone="secondary" className="button--sm invoice-unconfirmed__action" onClick={() => setConfirmOpen(true)}>
              {copy.resolve}
            </Button>
          </li>
          ) : null}
        </ol>

        <div className="invoice-unconfirmed__foot">
          <p className="invoice-unconfirmed__paused">
            <svg className="invoice-unconfirmed__lock" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="3.2" y="7" width="9.6" height="7" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5.4 7V5a2.6 2.6 0 0 1 5.2 0v2" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>
              {copy.paused}
            </span>
          </p>
          {providerResponse ? (
            <details className="invoice-unconfirmed__details">
              <summary>{copy.providerResponse}</summary>
              <p className="invoice-unconfirmed__response mono-text">{providerResponse}</p>
            </details>
          ) : null}
        </div>
      </div>
      {onMarkResolved ? (
        <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        initialFocus="cancel"
        title={copy.confirmTitle}
        description={interpolate(copy.confirmBody, { connection: connectionName })}
        cancelLabel={copy.confirmCancel}
        confirmLabel={copy.resolve}
        onConfirm={() => {
          setConfirmOpen(false);
          onMarkResolved();
        }}
        />
      ) : null}
    </div>
  );
}

function resolveCause(failureCode: FailureCode | null): string {
  const copy = getMessages('invoicing').invoice.inDoubt;
  if (failureCode === 'transport-timeout') return copy.causeTimeout;
  if (failureCode === 'provider-answer-inconclusive') return copy.causeInconclusive;
  return copy.causeUnknown;
}
