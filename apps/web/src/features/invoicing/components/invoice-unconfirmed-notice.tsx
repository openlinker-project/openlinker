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

import { useTranslation } from '../../../shared/i18n';
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
  onMarkResolved: () => void;
}

export function InvoiceUnconfirmedNotice({
  connectionName,
  failureCode,
  attemptedAt,
  providerResponse,
  onCheckProvider,
  onMarkResolved,
}: InvoiceUnconfirmedNoticeProps): ReactElement {
  const { t } = useTranslation();
  // "Mark resolved" asserts something OpenLinker cannot verify, so a stray
  // click must not be enough: it opens a confirm with focus on "Not yet".
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Only a timeout can honestly say "did not answer in time".
  const cause = (
    failureCode === 'transport-timeout'
      ? t('invoice.inDoubt.causeTimeout', '{{connection}} did not answer in time.')
      : t('invoice.inDoubt.causeUnknown', '{{connection}} did not confirm the result.')
  ).replace('{{connection}}', connectionName);

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
            {t('invoice.inDoubt.title', "We can't tell if this invoice was issued")}
          </strong>
          {attemptedAt ? (
            <TimeDisplay iso={attemptedAt} format="datetime" className="invoice-unconfirmed__time mono-text" />
          ) : null}
        </div>
        <p className="invoice-unconfirmed__cause">
          {cause} {t('invoice.inDoubt.maybe', 'The invoice may exist there, or it may not.')}
        </p>

        <ol className="invoice-unconfirmed__steps" aria-label={t('invoice.inDoubt.stepsLabel', 'To finish this order')}>
          <li className="invoice-unconfirmed__step">
            <span className="invoice-unconfirmed__n" aria-hidden="true">1</span>
            <span className="invoice-unconfirmed__text">
              {t('invoice.inDoubt.step1', "Look for this order's invoice in")} <strong>{connectionName}</strong>.
            </span>
            <Button tone="secondary" className="button--sm invoice-unconfirmed__action" onClick={onCheckProvider}>
              {t('invoice.inDoubt.check', 'Check provider')}
            </Button>
          </li>
          <li className="invoice-unconfirmed__step">
            <span className="invoice-unconfirmed__n" aria-hidden="true">2</span>
            <span className="invoice-unconfirmed__text">
              {t('invoice.inDoubt.step2', 'Mark it resolved once you know.')}
            </span>
            <Button tone="secondary" className="button--sm invoice-unconfirmed__action" onClick={() => setConfirmOpen(true)}>
              {t('invoice.inDoubt.resolve', 'Mark resolved')}
            </Button>
          </li>
        </ol>

        <div className="invoice-unconfirmed__foot">
          <p className="invoice-unconfirmed__paused">
            <svg className="invoice-unconfirmed__lock" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="3.2" y="7" width="9.6" height="7" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5.4 7V5a2.6 2.6 0 0 1 5.2 0v2" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>
              {t(
                'invoice.inDoubt.paused',
                "Retry and switching provider stay off until then, so this sale can't get two invoices.",
              )}
            </span>
          </p>
          {providerResponse ? (
            <details className="invoice-unconfirmed__details">
              <summary>{t('invoice.inDoubt.providerResponse', 'Provider response')}</summary>
              <p className="invoice-unconfirmed__response mono-text">{providerResponse}</p>
            </details>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        initialFocus="cancel"
        title={t('invoice.inDoubt.confirmTitle', 'Mark this invoice as resolved?')}
        description={t(
          'invoice.inDoubt.confirmBody',
          "Do this only after you've checked {{connection}}. OpenLinker can't check it for you.",
        ).replace('{{connection}}', connectionName)}
        cancelLabel={t('invoice.inDoubt.confirmCancel', 'Not yet')}
        confirmLabel={t('invoice.inDoubt.resolve', 'Mark resolved')}
        onConfirm={() => {
          setConfirmOpen(false);
          onMarkResolved();
        }}
      />
    </div>
  );
}
