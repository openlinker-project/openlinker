/**
 * BenchBuyerNote (#3539, D12, mockup M2 `bench` / `bench-ack` / `multi`)
 *
 * The buyer's message to the seller, above the hero card: the one thing on the
 * screen that can contradict the paperwork the packer is about to put in the
 * box ("no receipt inside"). Info tone, never warning - nothing is wrong - and
 * larger text, because it is read at arm's length.
 *
 * ## What it does and does not do
 *
 * - READ ONLY: the text comes from the order, the packer cannot edit it.
 * - "I have read the note" records who and when for THIS parcel. It never
 *   gates scanning and is not a parcel close (ADR-071 / D18): nothing here is
 *   awaited by the scan path, and the copy says so in as many words.
 * - After saving, the card collapses to one line ("Read by you at 14:31") so the
 *   reminder stays in view while the packer works, with "Show the whole note".
 * - On a split order the note shows on EVERY parcel; another parcel's reading is
 *   context only, since each packer acknowledges their own box.
 *
 * Renders nothing when there is no text: a packer can only act on words, and
 * "none", "unknown" and "not stored" are not told apart on this surface.
 *
 * @module apps/web/src/features/bench/components
 */
import { useRef, useState, type ReactElement } from 'react';

import { useSession } from '../../../shared/auth/use-session';
import { useClampOverflow } from '../../../shared/hooks/use-clamp-overflow';
import { Button } from '../../../shared/ui/button';
import { formatAbsoluteTime } from '../../../shared/format/format-date';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BenchParcel } from '../api/bench-parcel.types';
import { useBenchBuyerNoteAcknowledgeMutation } from '../hooks/use-bench-buyer-note-acknowledge-mutation';
import { benchParcelCopy } from '../lib/bench-parcel.copy';

const COPY = benchParcelCopy.buyerNote;

export interface BenchBuyerNoteProps {
  readonly parcel: BenchParcel;
  /** Whether this session may record a reading (`bench:write`). */
  readonly canAcknowledge: boolean;
  /**
   * The order has a note whose text this installation does not store (B-12).
   * The parcel carries no flag for it, so the caller reads it off the worklist
   * row. The card then says so and still offers the acknowledgement.
   */
  readonly textNotStored?: boolean;
}

function NoteIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 3h11v7.5h-6.5l-3 2.5v-2.5h-1.5z" />
    </svg>
  );
}

export function BenchBuyerNote({
  parcel,
  canAcknowledge,
  textNotStored = false,
}: BenchBuyerNoteProps): ReactElement | null {
  const { session } = useSession();
  const acknowledge = useBenchBuyerNoteAcknowledgeMutation();
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  // Measured, never estimated: only the browser knows whether the clamp cut
  // anything off at this width and font size.
  const noText = parcel.buyerNote === null || parcel.buyerNote.trim().length === 0;
  const overflowing = useClampOverflow(textRef, !expanded && !noText, [parcel.buyerNote]);

  if (noText && !textNotStored) return null;

  const currentUserId = session.user?.id ?? null;
  const read = parcel.buyerNoteAcknowledgedAt !== null;
  const wholeOrder = parcel.parcelTotal > 1;
  const refusedReason =
    acknowledge.data?.outcome === 'refused' ? (acknowledge.data.reason ?? 'unknown') : null;
  const failed = acknowledge.isError || refusedReason !== null;
  const titleId = `bench-buyer-note-title-${parcel.workId}`;
  const textId = `bench-buyer-note-text-${parcel.workId}`;

  if (read && parcel.buyerNoteAcknowledgedAt !== null) {
    const mine =
      currentUserId !== null && parcel.buyerNoteAcknowledgedByUserId === currentUserId;
    return (
      <section
        className="bench-buyer-note bench-buyer-note--read"
        aria-labelledby={titleId}
        data-testid="bench-buyer-note"
        data-state="read"
      >
        <div className="bench-buyer-note__head">
          <h3 className="bench-parcel__field-label" id={titleId} style={{ margin: 0 }}>
            <NoteIcon />
            {COPY.title}
          </h3>
          <StatusBadge tone="success" compact withDot data-testid="bench-buyer-note-read-badge">
            {COPY.readBy(
              mine ? COPY.you : COPY.someoneElse,
              formatAbsoluteTime(parcel.buyerNoteAcknowledgedAt),
            )}
          </StatusBadge>
        </div>
        {noText ? (
          <p className="bench-buyer-note__text" data-testid="bench-buyer-note-text-not-stored">
            {COPY.textNotStored}
          </p>
        ) : (
          <p
            className={`bench-buyer-note__text${expanded ? '' : ' bench-buyer-note__text--clamped'}`}
            id={textId}
            ref={textRef}
            lang="und"
            data-testid="bench-buyer-note-text"
          >
            {parcel.buyerNote}
          </p>
        )}
        {overflowing || expanded ? (
          <div className="bench-buyer-note__foot">
            <Button
              tone="ghost"
              data-testid="bench-buyer-note-expand"
              aria-expanded={expanded}
              aria-controls={textId}
              onClick={() => {
                setExpanded((value) => !value);
              }}
            >
              {expanded ? COPY.showLess : COPY.showAll}
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  const others = parcel.otherParcelBuyerNoteAcknowledgements;

  return (
    <section
      className="bench-buyer-note"
      aria-labelledby={titleId}
      data-testid="bench-buyer-note"
      data-state="unread"
    >
      <div className="bench-buyer-note__head">
        <h3 className="bench-parcel__field-label" id={titleId} style={{ margin: 0 }}>
          <NoteIcon />
          {COPY.title}
        </h3>
        <span className="bench-buyer-note__meta">
          {wholeOrder ? COPY.metaWholeOrder : COPY.meta}
        </span>
      </div>
      {noText ? (
        <p className="bench-buyer-note__text" data-testid="bench-buyer-note-text-not-stored">
          {COPY.textNotStored}
        </p>
      ) : (
        <p
          className={`bench-buyer-note__text${
            !expanded ? ' bench-buyer-note__text--clamped' : ''
          }`}
          id={textId}
          ref={textRef}
          lang="und"
          data-testid="bench-buyer-note-text"
        >
          {parcel.buyerNote}
        </p>
      )}
      {others.length > 0 ? (
        <p className="bench-buyer-note__others" data-testid="bench-buyer-note-others">
          {others
            .map((entry) =>
              COPY.otherRead(
                currentUserId !== null && entry.acknowledgedByUserId === currentUserId
                  ? COPY.otherReadYou
                  : COPY.otherReadSomeone,
                entry.parcelIndex,
                parcel.parcelTotal,
                formatAbsoluteTime(entry.acknowledgedAt),
              ),
            )
            .join(' ')}{' '}
          {COPY.eachBoxOwn}
        </p>
      ) : null}
      {failed ? (
        <p className="bench-buyer-note__error" role="alert" data-testid="bench-buyer-note-error">
          {refusedReason === 'not-claimable-by-viewer'
            ? COPY.lockedOut
            : refusedReason === 'work-cancelled'
              ? COPY.workCancelled
              : refusedReason === 'no-buyer-note'
                ? COPY.noBuyerNote
                : COPY.failed}
        </p>
      ) : null}
      <div className="bench-buyer-note__foot">
        {canAcknowledge ? (
          <Button
            tone="secondary"
            data-testid="bench-buyer-note-acknowledge"
            disabled={acknowledge.isPending}
            onClick={() => {
              acknowledge.mutate(parcel.workId);
            }}
          >
            {acknowledge.isPending ? COPY.saving : COPY.acknowledge}
          </Button>
        ) : null}
        {overflowing || expanded ? (
          <Button
            tone="ghost"
            data-testid="bench-buyer-note-expand"
            aria-expanded={expanded}
            aria-controls={textId}
            onClick={() => {
              setExpanded((value) => !value);
            }}
          >
            {expanded ? COPY.showLess : COPY.showAll}
          </Button>
        ) : null}
        {canAcknowledge ? <span className="bench-buyer-note__hint">{COPY.hint}</span> : null}
      </div>
    </section>
  );
}
