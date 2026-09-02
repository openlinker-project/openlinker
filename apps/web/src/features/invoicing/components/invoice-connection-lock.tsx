/**
 * Invoice Connection Lock (#2047)
 *
 * States the issuing connection as a FACT, not a control. Replaces the
 * connection `Select` that used to sit above an already-issued invoice (and the
 * "Invoiced via … locked" field row, whose "locked" claim the picker above it
 * contradicted — the operator believes the control, not the label).
 *
 * The eyebrow changes with the lifecycle because the same lock means something
 * slightly different in each state, but it is ONE rule: a record exists, so the
 * connection is settled.
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';

import { useTranslation } from '../../../shared/i18n';
import type { InvoiceDisplayStatus } from './invoice-status-badge';

export interface InvoiceConnectionLockProps {
  /** Display status the lock describes — drives the eyebrow + hint copy. */
  status: InvoiceDisplayStatus;
  /** Human name of the issuing connection; falls back to its id when unknown. */
  connectionName: string;
  /** Short tag next to the name: the platform type, or `disconnected` when stale. */
  tag: string;
  /** The connection can no longer act (deleted / disabled / capability revoked). */
  isStale: boolean;
}

type Translate = (key: string, fallback: string) => string;

function resolveEyebrow(status: InvoiceDisplayStatus, t: Translate): string {
  if (status === 'pending' || status === 'issuing') {
    return t('invoice.lock.issuingOn', 'Issuing on');
  }
  if (status === 'failed') {
    return t('invoice.lock.retryGoesTo', 'Retry goes to');
  }
  if (status === 'in-doubt') {
    return t('invoice.lock.stillAssignedTo', 'Still assigned to');
  }
  return t('invoice.lock.issuedBy', 'Issued by');
}

function resolveHint(status: InvoiceDisplayStatus, isStale: boolean, t: Translate): string {
  if (isStale) {
    return t(
      'invoice.lock.hintStale',
      'This connection is no longer active, so corrections and resends are unavailable here. The invoice itself stands.',
    );
  }
  if (status === 'pending') {
    return t(
      'invoice.lock.hintPending',
      'Already committed to this connection. The document number appears here when the provider responds.',
    );
  }
  if (status === 'issuing') {
    return t(
      'invoice.lock.hintIssuing',
      'An attempt is running and holds this invoice. A second attempt cannot start until it finishes or releases.',
    );
  }
  if (status === 'failed') {
    return t(
      'invoice.lock.hintFailed',
      'Retrying keeps the same connection, so the numbering series stays continuous.',
    );
  }
  if (status === 'in-doubt') {
    return t(
      'invoice.lock.hintInDoubt',
      'No provider change and no one-click retry while the outcome is unknown.',
    );
  }
  return t(
    'invoice.lock.hintIssued',
    'This order is invoiced here. Every further action on it - correction, resend, email, mark paid - goes to this connection.',
  );
}

/** Glyph + stripe tone follow the lifecycle: settled, in-flight, or unusable. */
function resolveTone(status: InvoiceDisplayStatus, isStale: boolean): string {
  if (isStale || status === 'failed' || status === 'in-doubt') {
    return 'invoice-connection-lock--stale';
  }
  if (status === 'pending' || status === 'issuing') {
    return 'invoice-connection-lock--pending';
  }
  return '';
}

export function InvoiceConnectionLock({
  status,
  connectionName,
  tag,
  isStale,
}: InvoiceConnectionLockProps): ReactElement {
  const { t } = useTranslation();
  const glyph = status === 'failed' && !isStale ? '↻' : '🔒';
  const hint = resolveHint(status, isStale, t);
  // #2807 review — the mockup keeps the routing/lock rationale for a SETTLED
  // document behind a collapsed "Why this document?" disclosure (secondary,
  // sitting beside the correction/override actions), not as an always-visible
  // paragraph competing with the primary content. Every OTHER hint here is
  // operational status the operator needs to see without an extra click
  // (a running attempt, a failed retry's numbering note, an in-doubt caution,
  // a stale connection's limitation) — those stay visible.
  const isSettled = !isStale && status !== 'pending' && status !== 'issuing' && status !== 'failed' && status !== 'in-doubt';

  return (
    <div
      className={['invoice-connection-lock', resolveTone(status, isStale)]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="invoice-connection-lock__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="invoice-connection-lock__eyebrow">{resolveEyebrow(status, t)}</span>
      <span className="invoice-connection-lock__value">
        {connectionName}
        <span className="invoice-connection-lock__tag mono-text">{tag}</span>
      </span>
      {isSettled ? (
        <details className="sales-document-panel__routing-disclosure invoice-connection-lock__why">
          <summary>{t('salesDocument.panel.whyThisDocument', 'Why this document?')}</summary>
          <span className="invoice-connection-lock__hint">{hint}</span>
        </details>
      ) : (
        <span className="invoice-connection-lock__hint">{hint}</span>
      )}
    </div>
  );
}
