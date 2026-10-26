/**
 * OrderBuyerNote (#3539, mockup M2 `detail` / `long`)
 *
 * The buyer's message to the seller, in the full-width slot under the health
 * strip. It is deliberately NOT an `Alert`: an Alert is OpenLinker speaking, and
 * this is the buyer's voice - a neutral surface with a blue edge, the text
 * verbatim (`lang` hint, line breaks preserved), and a frame that names who
 * wrote it, where, and when. OpenLinker extracts nothing from the text.
 *
 * Renders NOTHING for "none" and "unknown" (no empty block, no "No buyer note"
 * reassurance - the source not saying is not the buyer saying nothing). The one
 * extra state is a note that exists but whose text is not stored
 * (`OL_STORE_PII=false`), which says so quietly rather than hiding that a note
 * was left.
 *
 * Two independent read facts sit side by side and must not be merged: the
 * ORDER-level "an operator read it" marker (this block's button) and the
 * PER-PARCEL "read at the bench" acknowledgements (display only here).
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useSession } from '../../../shared/auth/use-session';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useDemoMode } from '../../system';
import { readBuyerNote } from '../api/buyer-note.schema';
import type { OrderRecord } from '../api/orders.types';
import { useMarkBuyerNoteReadMutation } from '../hooks/use-mark-buyer-note-read-mutation';
import { BUYER_NOTE_COPY as COPY } from '../lib/buyer-note.copy';
import { describeNoteActor, isLongBuyerNote } from '../lib/buyer-note-presentation';
import { copyTextToClipboard } from '../lib/clipboard-write';
import { BuyerNoteIcon } from './buyer-note-icon';

export interface OrderBuyerNoteProps {
  order: Pick<
    OrderRecord,
    | 'internalOrderId'
    | 'hasBuyerNote'
    | 'buyerNote'
    | 'buyerNoteReadAt'
    | 'buyerNoteReadByUserId'
    | 'buyerNoteAcknowledgements'
  >;
  /** The source channel's display name, when it could be resolved. */
  channelLabel: string | null;
  /** The source platform type, for the channel pill's colour. */
  channelPlatform: string | null;
  /** When the buyer wrote it: the order's placement instant. */
  placedAt: string | null;
}

export function OrderBuyerNote({
  order,
  channelLabel,
  channelPlatform,
  placedAt,
}: OrderBuyerNoteProps): ReactElement | null {
  const view = readBuyerNote(order);
  const { session } = useSession();
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const markRead = useMarkBuyerNoteReadMutation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (view.kind === 'none' || view.kind === 'unknown') return null;

  if (view.kind === 'text-not-stored') {
    return (
      <section
        className="buyer-note"
        aria-label={COPY.title}
        data-testid="order-buyer-note"
        data-state="text-not-stored"
      >
        <h3 className="buyer-note__title">
          <BuyerNoteIcon />
          {COPY.title}
        </h3>
        <p className="buyer-note__meta">{COPY.textNotStored}</p>
      </section>
    );
  }

  const long = isLongBuyerNote(view.text);
  const clamped = long && !expanded;
  const unread = view.readAt === null;
  const currentUserId = session.user?.id ?? null;
  const readActor = describeNoteActor(view.readByUserId, currentUserId);
  const titleId = `buyer-note-title-${order.internalOrderId}`;

  const handleCopy = (): void => {
    void copyTextToClipboard(view.text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        setCopied(false);
        copiedTimer.current = null;
      }, 1500);
    });
  };

  return (
    <section
      className={`buyer-note${unread ? ' buyer-note--unread' : ''}`}
      aria-labelledby={titleId}
      data-testid="order-buyer-note"
      data-state={unread ? 'unread' : 'read'}
    >
      <div className="buyer-note__head">
        <h3 className="buyer-note__title" id={titleId}>
          <BuyerNoteIcon />
          {COPY.title}
        </h3>
        {channelLabel !== null ? (
          <span className="channel-pill" data-channel={channelPlatform ?? undefined}>
            {channelLabel}
          </span>
        ) : null}
        <span className="buyer-note__meta" data-testid="order-buyer-note-meta">
          {COPY.meta(null)}
          {placedAt !== null ? (
            <>
              {' · '}
              <TimeDisplay iso={placedAt} className="mono-text tabular" />
            </>
          ) : null}
        </span>
        <span className="buyer-note__actions">
          <Button
            tone="ghost"
            className="button--sm"
            data-testid="order-buyer-note-copy"
            aria-label={COPY.copyAria}
            onClick={handleCopy}
          >
            {copied ? COPY.copied : COPY.copy}
          </Button>
          {unread && write.visible ? (
            <Button
              tone="secondary"
              className="button--sm"
              data-testid="order-buyer-note-mark-read"
              disabled={write.demoReadOnly || markRead.isPending}
              onClick={() => {
                markRead.mutate(order.internalOrderId);
              }}
            >
              {markRead.isPending ? COPY.markingRead : COPY.markRead}
            </Button>
          ) : null}
        </span>
      </div>

      <p
        className={`buyer-note__text${clamped ? ' buyer-note__text--clamped' : ''}`}
        lang="und"
        id={`buyer-note-text-${order.internalOrderId}`}
        data-testid="order-buyer-note-text"
        data-clamped={clamped ? 'true' : 'false'}
      >
        {view.text}
      </p>

      {markRead.isError ? (
        <p className="buyer-note__error" role="alert" data-testid="order-buyer-note-error">
          {COPY.markReadFailed}
        </p>
      ) : null}

      <p className="buyer-note__foot">
        {long ? (
          <Button
            tone="ghost"
            className="button--sm"
            data-testid="order-buyer-note-expand"
            aria-expanded={expanded}
            aria-controls={`buyer-note-text-${order.internalOrderId}`}
            onClick={() => {
              setExpanded((value) => !value);
            }}
          >
            {expanded ? COPY.showLess : COPY.showAll(view.text.length)}
          </Button>
        ) : null}
        {unread ? (
          <StatusBadge tone="info" compact withDot data-testid="order-buyer-note-read-state">
            {COPY.unread}
          </StatusBadge>
        ) : (
          <StatusBadge tone="success" compact withDot data-testid="order-buyer-note-read-state">
            {COPY.readBy(readActor)}
          </StatusBadge>
        )}
        {view.readAt !== null ? (
          <TimeDisplay iso={view.readAt} className="mono-text tabular" />
        ) : null}
        {view.acknowledgements.length === 0 ? (
          <span data-testid="order-buyer-note-bench-state">{COPY.notReadAtBench}</span>
        ) : (
          <span className="buyer-note__bench" data-testid="order-buyer-note-bench-state">
            <StatusBadge tone="success" compact withDot>
              {COPY.readAtBench}
            </StatusBadge>
            {view.acknowledgements.map((ack) => (
              <span key={ack.workId} data-testid="order-buyer-note-bench-ack">
                {describeNoteActor(ack.acknowledgedByUserId, currentUserId) ?? COPY.aPacker}
                {' · '}
                <TimeDisplay iso={ack.acknowledgedAt} className="mono-text tabular" />
              </span>
            ))}
          </span>
        )}
      </p>
    </section>
  );
}
