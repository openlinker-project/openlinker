/**
 * One parcel on the bench (#2416, `W3b-3`, stories B2/B4/B5)
 *
 * ## State is never colour alone (B4)
 *
 * Every state this row can be in is written in WORDS — the deadline headline,
 * the hold or cancellation sentence, the expedited badge — and the row also
 * sits in its own section (`groupBenchWork`). The tinting and the badge tone are
 * additions to that. `bench-work-row.test.tsx` asserts state from `textContent`
 * only, so a change that moved a signal into colour would fail.
 *
 * ## Nothing here says the goods are ready (B2)
 *
 * The counts read *lines* and *units to verify*. There is no "picked", no
 * "gathered", no progress bar — a bar would imply someone had already fetched
 * part of it, which OpenLinker has no way to know.
 *
 * ## There is no "open parcel" control yet
 *
 * Opening a parcel is #2418. `onOpenParcel` is the seam it passes in; while it
 * is absent this row renders no control for it, because a button wired to
 * nothing is worse than a missing one on a surface someone works at speed.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { BenchWork } from '../api/bench-work.types';
import { describeBenchDeadline, expediteActionFor } from '../lib/bench-work-presentation';
import { benchWorkCopy } from '../lib/bench-work.copy';

export interface BenchWorkRowProps {
  readonly work: BenchWork;
  /** `now` is injected so the deadline phrasing is testable without a clock. */
  readonly now?: Date;
  /** Whether this session may reorder the queue. See `BenchWorkList`. */
  readonly canExpedite: boolean;
  readonly onExpedite: (work: BenchWork, action: 'expedite' | 'release_expedite') => void;
  readonly expediting?: boolean;
  /** #2418's seam. Absent renders no control — see the module docblock. */
  readonly onOpenParcel?: (work: BenchWork) => void;
}

function toneFor(work: BenchWork): StatusBadgeTone {
  if (work.state === 'cancelled') return 'neutral';
  if (work.state === 'held') return 'error';
  return 'info';
}

export function BenchWorkRow({
  work,
  now,
  canExpedite,
  onExpedite,
  expediting = false,
  onOpenParcel,
}: BenchWorkRowProps): ReactElement {
  const deadline = describeBenchDeadline(work.dispatchByAt, now);
  const expediteAction = expediteActionFor(work);
  const expedited = work.expeditedAt !== null;

  return (
    <li
      className={`bench-work-row bench-work-row--${work.state}`}
      data-testid="bench-work-row"
      data-work-id={work.workId}
    >
      <div className="bench-work-row__deadline">
        {/* The headline is words, always — never a bare colour bar. */}
        <span className="bench-work-row__deadline-headline">
          {work.state === 'held'
            ? benchWorkCopy.row.heldTitle
            : work.state === 'cancelled'
              ? benchWorkCopy.row.cancelledTitle
              : deadline.headline}
        </span>
        {deadline.remaining !== null && work.state === 'packable' ? (
          <span className="bench-work-row__deadline-detail">{deadline.remaining}</span>
        ) : null}
      </div>

      <div className="bench-work-row__identity">
        <span className="bench-work-row__reference">{work.orderReference}</span>
        <span className="bench-work-row__meta">
          {work.buyerName === null ? null : <>{work.buyerName} · </>}
          {benchWorkCopy.row.summary({
            parcelIndex: work.parcelIndex,
            parcelTotal: work.parcelTotal,
            lineCount: work.lineCount,
            unitsToVerify: work.unitsToVerify,
          })}
        </span>
        {work.state === 'held' ? (
          <span className="bench-work-row__note">{benchWorkCopy.row.heldBody}</span>
        ) : null}
        {work.state === 'cancelled' ? (
          <span className="bench-work-row__note">{benchWorkCopy.row.cancelledBody}</span>
        ) : null}
      </div>

      <div className="bench-work-row__state">
        {expedited ? (
          <StatusBadge tone="warning" withDot>
            {benchWorkCopy.row.expeditedBadge}
          </StatusBadge>
        ) : null}
        {work.state !== 'packable' ? (
          <StatusBadge tone={toneFor(work)} withDot>
            {work.state === 'held'
              ? benchWorkCopy.row.heldBadge
              : benchWorkCopy.row.cancelledBadge}
          </StatusBadge>
        ) : null}
      </div>

      <div className="bench-work-row__actions">
        {/* Offered only when the SERVER says the verb is legal, and only to a
            session that may write. A packer sees the badge and no control. */}
        {canExpedite && expediteAction !== null ? (
          <Button
            tone="secondary"
            disabled={expediting}
            onClick={() => {
              onExpedite(work, expediteAction);
            }}
          >
            {expediteAction === 'expedite'
              ? benchWorkCopy.row.expediteAction
              : benchWorkCopy.row.releaseExpediteAction}
          </Button>
        ) : null}
        {onOpenParcel === undefined ? null : (
          <Button
            tone="primary"
            onClick={() => {
              onOpenParcel(work);
            }}
          >
            {benchWorkCopy.row.openAction}
          </Button>
        )}
      </div>
    </li>
  );
}
