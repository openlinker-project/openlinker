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
 * #3766 - a SETTLED document (issued, connection still live) renders no box at
 * all: the headline above the slot already names the connection, so the box
 * only repeated it. What is left is the "Why this document?" disclosure, which
 * the panel places last in the slot. Every other state keeps the box, because
 * there the hint is operational status the operator needs to see.
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';

import { interpolate, useMessages } from '../../../shared/i18n';
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

type LockCopy = ReturnType<typeof useMessages<'invoicing'>>['invoice']['lock'];

function resolveEyebrow(status: InvoiceDisplayStatus, copy: LockCopy): string {
  if (status === 'pending' || status === 'issuing') return copy.issuingOn;
  if (status === 'failed') return copy.retryGoesTo;
  if (status === 'in-doubt') return copy.stillAssignedTo;
  return copy.issuedBy;
}

function resolveHint(
  status: InvoiceDisplayStatus,
  isStale: boolean,
  connectionName: string,
  copy: LockCopy,
): string {
  if (isStale) return copy.hintStale;
  if (status === 'pending') return copy.hintPending;
  if (status === 'issuing') return copy.hintIssuing;
  if (status === 'failed') return copy.hintFailed;
  if (status === 'in-doubt') return copy.hintInDoubt;
  // #3766 - also carries the one-document rule the removed "This order already
  // has a document" alert used to state, so the rule stays one click away.
  return interpolate(copy.hintIssued, { connection: connectionName });
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
  const messages = useMessages('invoicing');
  const copy = messages.invoice.lock;
  const glyph = status === 'failed' && !isStale ? '↻' : '🔒';
  const hint = resolveHint(status, isStale, connectionName, copy);
  // #2807 review — the mockup keeps the routing/lock rationale for a SETTLED
  // document behind a collapsed "Why this document?" disclosure (secondary,
  // sitting beside the correction/override actions), not as an always-visible
  // paragraph competing with the primary content. Every OTHER hint here is
  // operational status the operator needs to see without an extra click
  // (a running attempt, a failed retry's numbering note, an in-doubt caution,
  // a stale connection's limitation) — those stay visible.
  const isSettled = !isStale && status !== 'pending' && status !== 'issuing' && status !== 'failed' && status !== 'in-doubt';

  if (isSettled) {
    return (
      <details className="sales-document-panel__routing-disclosure" data-testid="invoice-why-this-document">
        <summary>{messages.salesDocument.panel.whyThisDocument}</summary>
        <p className="panel-copy">{hint}</p>
      </details>
    );
  }

  return (
    <div
      className={['invoice-connection-lock', resolveTone(status, isStale)]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="invoice-connection-lock__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="invoice-connection-lock__eyebrow">{resolveEyebrow(status, copy)}</span>
      <span className="invoice-connection-lock__value">
        <span className="invoice-connection-lock__name">{connectionName}</span>
        <span className="invoice-connection-lock__tag mono-text">{tag}</span>
      </span>
      <span className="invoice-connection-lock__hint">{hint}</span>
    </div>
  );
}
