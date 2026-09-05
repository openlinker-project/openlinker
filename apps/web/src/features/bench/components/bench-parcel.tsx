/**
 * The open box (#2418, `W3b-5`, Surfaces D and E)
 *
 * Everything that happens to one parcel: it opens, units go into it, and it
 * shuts itself.
 *
 * ## There is NO commit control, and its absence is the design (D18/E5)
 *
 * No "Done", no "Close parcel", no "Confirm", no "Finish" — not disabled, not
 * hidden behind a condition, not as a fallback. The API has no close route to
 * call, because the close happens inside the last verification's own
 * transaction; a button here would have nothing to press. The footer states the
 * promise to the packer in the mockup's own words, and
 * `bench-parcel.test.tsx` fails the build on any button whose accessible name
 * reads like a commit — the browser-side twin of the backend's
 * `no-parcel-commit-control.spec.ts`.
 *
 * ## The wrong item never leaves the browser (E2)
 *
 * A scan is matched against this box's own codes by `matchScanToParcelLine`, and
 * an unmatched one is refused here: no request, nothing recorded, and the
 * refusal names what the box was waiting for as well as what was scanned. The
 * server is asked only about scans that belong in this box.
 *
 * ## The interrupt fires on ONE condition (D4/D21)
 *
 * `hasBecomeUnpackable` reads `refusal` and nothing else — the same field the
 * work list colours its rows from. A buyer's address, a price, a document: none
 * of them can move it. That is deliberate; an interruption that goes off for a
 * change the packer cannot act on trains people to dismiss interruptions, and
 * then the one that matters is dismissed too.
 *
 * ## Nothing is claimed before the server accepts it (#2421, story H2)
 *
 * There is no optimistic write here and there must never be one: the count and
 * the badges come from the server's own answer, and a gesture in the air is
 * shown as *in flight* beside them. Under D18 the box closes on the SYSTEM's
 * count with no confirmation step, so a packer reading an optimistic screen
 * would never reach a moment where their belief and the system's were compared.
 *
 * Three mechanics make "the operator is never left unable to tell whether their
 * last scan counted" true rather than aspirational:
 *
 * 1. **A per-line in-flight counter**, incremented before the request and
 *    decremented on any settle. `verify.isPending` is deliberately NOT used —
 *    one `useMutation` observer reports only the latest gesture, so it goes
 *    false while earlier ones are still out.
 * 2. **A gesture SEQUENCE**, so a late answer from an older scan cannot clear
 *    the refusal a newer scan just raised. Without it a wrong-item warning
 *    disappears on its own and the packer carries on.
 * 3. **One `aria-live` region** carrying acceptance and in-flight. Refusals are
 *    deliberately absent from it: `Alert tone="error"` is already `role="alert"`,
 *    so announcing them here too would say each refusal twice.
 *
 * ## Offline refuses out loud, and is not a queue (#2421, story H1)
 *
 * The scanner stays ATTACHED while the bench cannot reach OpenLinker, and the
 * unreachable check is the first thing `onScan` does. Detaching the listener
 * would swallow the scan instead of refusing it, which is the failure C3 exists
 * to prevent one state over. Nothing is stored and nothing is replayed — see
 * `use-bench-reachability.ts` for why a queue is the wrong size of answer.
 *
 * @module apps/web/src/features/bench/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BenchParcel, BenchParcelLine } from '../api/bench-parcel.types';
import { useBenchParcelQuery } from '../hooks/use-bench-parcel-query';
import { useBenchReachability, isUnreachableFailure } from '../hooks/use-bench-reachability';
import { useBenchReopenMutation } from '../hooks/use-bench-reopen-mutation';
import { useBenchVerifyMutation } from '../hooks/use-bench-verify-mutation';
import { useScannerInput } from '../hooks/use-scanner-input';
import {
  describeParcelRefusal,
  describeReopenRefusal,
  describeVerificationRefusal,
  hasBecomeUnpackable,
  isParcelClosed,
  parcelTotals,
} from '../lib/bench-parcel-presentation';
import { benchParcelCopy } from '../lib/bench-parcel.copy';
import {
  isBenchAudioMuted,
  playScanSound,
  setBenchAudioMuted,
  type ScanSoundKind,
} from '../lib/bench-scan-sound';
import { matchScanToParcelLine, outstandingScanCodes } from '../lib/parcel-scan-match';
import { beginGesture } from '../lib/scanner-gesture-log';
import { BenchDocumentsPanel } from './bench-documents';
import { BenchParcelLineRow } from './bench-parcel-line';

export interface BenchParcelProps {
  readonly workId: string;
  /** Leaving this box. The bench's only exit from the parcel, per story C2. */
  readonly onClose: () => void;
}

/**
 * What the surface is currently telling the packer about their last gesture.
 *
 * `seq` is the gesture's sequence number and is what stops a late answer from
 * an OLDER scan clearing a newer scan's refusal — the packer would otherwise
 * watch a wrong-item warning disappear by itself and carry on packing.
 */
type ScanNotice = { readonly seq: number } & (
  | { readonly kind: 'wrong-item'; readonly scanned: string; readonly expected: readonly string[] }
  | { readonly kind: 'refused'; readonly message: string; readonly overPacked: boolean }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'failed'; readonly lineName: string }
);

export function BenchParcelView({ workId, onClose }: BenchParcelProps): ReactElement {
  const query = useBenchParcelQuery(workId);
  const verify = useBenchVerifyMutation();
  const reopen = useBenchReopenMutation();
  const reachability = useBenchReachability();

  const [notice, setNotice] = useState<ScanNotice | null>(null);
  const [interrupted, setInterrupted] = useState<string | null>(null);
  const [reopenNotice, setReopenNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => isBenchAudioMuted());

  /**
   * H2's in-flight ledger: line id → gestures sent and unanswered.
   *
   * Deliberately NOT `verify.isPending`, which reports the latest gesture only
   * and goes false while earlier ones are still out — the exact window in which
   * a packer needs to be told something is happening.
   */
  const [inFlight, setInFlight] = useState<Readonly<Record<string, number>>>({});
  const [announcement, setAnnouncement] = useState('');

  // Monotonic per gesture. A ref, not state: it is read and written inside the
  // scan handler and must never trigger a render of its own.
  const sequence = useRef(0);

  const parcel = query.data;
  const closed = parcel !== undefined && isParcelClosed(parcel);
  const refused = parcel !== undefined && parcel.refusal !== null;

  // D4/D21. Compared against the PREVIOUS read rather than against a flag, so a
  // box that was already refused when it opened shows D2's screen and never an
  // alarm about a fact the packer is looking at.
  const previous = useRef<BenchParcel | undefined>(undefined);
  useEffect(() => {
    if (parcel === undefined) return;
    if (hasBecomeUnpackable(previous.current, parcel) && parcel.refusal !== null) {
      setInterrupted(parcel.refusal);
    }
    previous.current = parcel;
  }, [parcel]);

  // The parcel is read through a ref inside the scan handler for the reason the
  // scanner hook holds its callback in one: the listener is attached once, and a
  // handler closing over a stale render would match a scan against last poll's
  // counts.
  const parcelRef = useRef<BenchParcel | undefined>(undefined);
  parcelRef.current = parcel;

  // Same reason, and load-bearing for H1: the scan handler must refuse against
  // the CURRENT reachability, not the one that held when the listener attached.
  const reachabilityRef = useRef(false);
  reachabilityRef.current = reachability.unreachable;

  /**
   * The poll is the reachability probe that needs no packer.
   *
   * `useBenchParcelQuery` re-reads on an interval, so the bench learns it is
   * back without anyone scanning into a refusal to find out — which is what
   * keeps the unreachable state from latching on a bench whose own link never
   * went down. Every answer counts, an error one included: a 500 is the server
   * talking.
   */
  useEffect(() => {
    if (query.isFetching) return;
    if (query.isSuccess) {
      reachability.reportReached();
      return;
    }
    if (query.isError) {
      if (isUnreachableFailure(query.error)) reachability.reportUnreachable();
      else reachability.reportReached();
    }
    // `reachability`'s two reporters are `useCallback`-stable, so this runs on a
    // change of query state rather than on every render.
  }, [query.isFetching, query.isSuccess, query.isError, query.error, reachability]);

  /** The one place a refusal is both shown and sounded, so the two cannot drift. */
  const raise = (next: ScanNotice, sound: ScanSoundKind): void => {
    // Only a NEWER gesture may replace what is on screen. An older answer
    // arriving late leaves the packer's most recent refusal standing.
    setNotice((current) => (current !== null && current.seq > next.seq ? current : next));
    playScanSound(sound);
  };

  const lineName = (line: BenchParcelLine): string =>
    line.name ?? benchParcelCopy.lines.unnamed;

  const adjustInFlight = (workLineId: string, by: number): void => {
    setInFlight((current) => {
      const next = Math.max(0, (current[workLineId] ?? 0) + by);
      const copy = { ...current };
      if (next === 0) delete copy[workLineId];
      else copy[workLineId] = next;
      return copy;
    });
  };

  /**
   * Send one gesture, and account for it however late its answer arrives.
   *
   * `mutateAsync`, deliberately, and NOT `mutate(vars, { onSuccess, onError })`.
   * One `useMutation` observer serves every gesture, and a second `mutate` call
   * ORPHANS the first: TanStack Query still runs the mutation and still fires
   * the hook's CONFIG-level callbacks for it (which is what keeps
   * `settleGesture` and the guarded cache write honest for every gesture — see
   * `use-bench-verify-mutation.ts`), but it **drops the per-call callbacks of
   * every mutation but the latest**. Measured, not assumed.
   *
   * Putting the per-gesture bookkeeping in those per-call callbacks would
   * therefore leave an overtaken gesture's in-flight marker standing for ever
   * and its refusal never shown — a packer permanently unable to tell whether
   * their scan counted, which is the exact state H2 forbids. The promise
   * `mutateAsync` returns settles for THIS call whatever else the observer does.
   */
  const submit = (line: BenchParcelLine, gestureId: string, seq: number): void => {
    // Before the request, so the surface never has a silent window between the
    // packer's act and the screen acknowledging it.
    adjustInFlight(line.workLineId, 1);
    setAnnouncement(benchParcelCopy.inFlight.sentAnnouncement(lineName(line)));

    verify
      .mutateAsync({ workId, workLineId: line.workLineId, gestureId })
      .then((result) => {
        adjustInFlight(line.workLineId, -1);
        // The server answered — whatever it answered, the bench is reachable.
        reachability.reportReached();

        const answered = result.parcel.lines.find(
          (candidate) => candidate.workLineId === line.workLineId
        );

        if (result.outcome === 'refused') {
          raise(
            {
              seq,
              kind: 'refused',
              message: describeVerificationRefusal(result.reason, answered),
              overPacked: result.reason === 'over-packed',
            },
            // C4's named pair. `over-packed` is the box being full, which is a
            // different act from the item being wrong, so it gets its own
            // sound rather than sharing the generic refusal one.
            result.reason === 'over-packed' ? 'over-scan' : 'failed'
          );
          return;
        }

        // Accepted. Announced here and nowhere else — this is the only outcome
        // no `role="alert"` already speaks.
        setAnnouncement(
          benchParcelCopy.inFlight.recordedAnnouncement({
            name: lineName(line),
            verified: answered?.verifiedQuantity ?? 0,
            required: answered?.requiredQuantity ?? 0,
          })
        );
        // Clears only what this gesture or an older one put up.
        setNotice((current) => (current !== null && current.seq > seq ? current : null));
      })
      .catch((error: unknown) => {
        adjustInFlight(line.workLineId, -1);
        if (isUnreachableFailure(error)) reachability.reportUnreachable();
        // The gesture id is deliberately NOT settled on this path (see the
        // mutation's docblock), so scanning the same item again reuses it and
        // the server records one unit however many times it arrives.
        raise({ seq, kind: 'failed', lineName: lineName(line) }, 'failed');
      });
  };

  useScannerInput({
    // Off while the box is closed, refused or still loading: a scan made then
    // has nothing it could legitimately record, and accepting it would be the
    // surface pretending to work.
    enabled: parcel !== undefined && !closed && !refused,
    onScan: (gesture) => {
      const current = parcelRef.current;
      if (current === undefined) return;

      sequence.current += 1;
      const seq = sequence.current;

      // H1, and FIRST. The listener stays attached while the bench is out of
      // touch precisely so this branch can run: detaching it would swallow the
      // scan, which is the failure C3 exists to prevent one state over. Nothing
      // is stored and nothing will be replayed — the packer is told to scan the
      // item again once the bench is back.
      if (reachabilityRef.current) {
        raise({ seq, kind: 'unreachable' }, 'unreachable');
        return;
      }

      const match = matchScanToParcelLine(current, gesture.value);
      if (match.kind === 'matched') {
        submit(match.line, gesture.gestureId, seq);
        return;
      }

      // E2/E3 answered in the browser. Nothing is sent, and nothing is
      // recorded — including the gesture id, which stays pending because no
      // server ever saw it.
      if (match.kind === 'already-full') {
        raise(
          {
            seq,
            kind: 'refused',
            message: benchParcelCopy.verify.overPacked({
              required: match.line.requiredQuantity,
              kept: match.line.verifiedQuantity,
            }),
            overPacked: true,
          },
          'over-scan'
        );
        return;
      }

      raise(
        {
          seq,
          kind: 'wrong-item',
          scanned: gesture.value,
          expected: outstandingScanCodes(current),
        },
        'wrong-item'
      );
    },
  });

  if (parcel === undefined && query.isPending) {
    return (
      <LoadingState title={benchParcelCopy.loading.title} message={benchParcelCopy.loading.body} />
    );
  }

  if (parcel === undefined) {
    return (
      <ErrorState
        title={benchParcelCopy.errors.loadTitle}
        message={query.error?.message ?? ''}
        action={
          <Button
            tone="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            {benchParcelCopy.errors.retryAction}
          </Button>
        }
      />
    );
  }

  const totals = parcelTotals(parcel);
  const refusalCopy = parcel.refusal === null ? null : describeParcelRefusal(parcel.refusal);

  return (
    <section className="bench-parcel" data-testid="bench-parcel" data-work-id={parcel.workId}>
      <header className="bench-parcel__header">
        <div className="bench-parcel__identity">
          <span className="eyebrow">{benchParcelCopy.header.orderLabel}</span>
          <span className="bench-parcel__reference">{parcel.orderReference}</span>
        </div>
        {parcel.buyerName === null ? null : (
          <div className="bench-parcel__identity">
            <span className="eyebrow">{benchParcelCopy.header.buyerLabel}</span>
            <span className="bench-parcel__buyer">{parcel.buyerName}</span>
          </div>
        )}
        {/* D3. Rendered on every state of this surface, never conditionally. */}
        <StatusBadge tone="info">
          {benchParcelCopy.header.parcelOf(parcel.parcelIndex, parcel.parcelTotal)}
        </StatusBadge>
        <Button tone="ghost" onClick={onClose}>
          {benchParcelCopy.header.backAction}
        </Button>
      </header>

      <p className="bench-parcel__scope">{benchParcelCopy.header.thisBoxOnly}</p>
      <p className="bench-parcel__progress">
        {benchParcelCopy.header.progress(totals.verified, totals.required)}
      </p>

      {/* H2's running answer to "did that count?". POLITE, and carrying only
          acceptance and in-flight — every refusal below is already inside a
          `role="alert"`, and repeating it here would say each one twice. */}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="bench-parcel-announcer"
      >
        {announcement}
      </p>

      {/* H1. Above the lines and never dismissible: the packer must not be able
          to clear it and go on scanning into a bench that cannot record. */}
      {reachability.unreachable ? (
        <Alert tone="warning" title={benchParcelCopy.unreachable.title}>
          {benchParcelCopy.unreachable.body}{' '}
          <span className="bench-parcel__unreachable-next">
            {benchParcelCopy.unreachable.whatToDo}
          </span>
        </Alert>
      ) : null}

      {/* D4/D21 — the interrupt. Blocking, because the point is that the packer
          stops scanning rather than reads a note beside a box they are filling. */}
      {interrupted === null ? null : (
        <Alert
          tone="error"
          title={describeParcelRefusal(interrupted).interruptTitle}
          action={
            <Button
              tone="primary"
              onClick={() => {
                setInterrupted(null);
                onClose();
              }}
            >
              {benchParcelCopy.interrupt.acknowledgeAction}
            </Button>
          }
        >
          {benchParcelCopy.interrupt.body}
        </Alert>
      )}

      {/* D2 — the same eligibility rule the list uses, so the two never disagree. */}
      {refusalCopy === null ? null : (
        <Alert tone="error" title={refusalCopy.title}>
          {refusalCopy.body}
          {parcel.holdReason === null ? null : (
            <span className="bench-parcel__hold-reason">
              {' '}
              {benchParcelCopy.refusal.reasonLabel}: {parcel.holdReason}
            </span>
          )}
        </Alert>
      )}

      {notice === null ? null : (
        <Alert
          tone="error"
          title={
            notice.kind === 'wrong-item'
              ? benchParcelCopy.verify.wrongItemTitle
              : notice.kind === 'failed'
                ? benchParcelCopy.inFlight.unresolvedTitle
                : notice.kind === 'unreachable'
                  ? benchParcelCopy.unreachable.refusedTitle
                  : benchParcelCopy.verify.overPackedBadge
          }
          action={
            <Button
              tone="secondary"
              onClick={() => {
                setNotice(null);
              }}
            >
              {benchParcelCopy.verify.dismissAction}
            </Button>
          }
        >
          {notice.kind === 'wrong-item' ? (
            <>
              {benchParcelCopy.verify.wrongItemBody({
                scanned: notice.scanned,
                expected: notice.expected,
              })}{' '}
              <span className="bench-parcel__scanned">
                {benchParcelCopy.verify.scannedLabel}: <code>{notice.scanned}</code>
              </span>
            </>
          ) : notice.kind === 'failed' ? (
            // Names WHICH scan, because with several gestures in flight a bare
            // "that did not go through" leaves the packer unable to tell which
            // one — the state H2 forbids.
            benchParcelCopy.inFlight.unresolved(notice.lineName)
          ) : notice.kind === 'unreachable' ? (
            benchParcelCopy.unreachable.refusedBody
          ) : (
            notice.message
          )}
        </Alert>
      )}

      {closed ? (
        <div className="bench-parcel__closed" data-testid="bench-parcel-closed">
          <h2 className="bench-parcel__closed-title">{benchParcelCopy.closed.title}</h2>
          <p className="bench-parcel__closed-summary">
            {benchParcelCopy.closed.summary({
              orderReference: parcel.orderReference,
              index: parcel.parcelIndex,
              total: parcel.parcelTotal,
            })}
          </p>
          <p>{benchParcelCopy.closed.body(totals.verified)}</p>
          <p className="bench-parcel__closed-next">{benchParcelCopy.closed.next}</p>

          {reopenNotice === null ? null : <Alert tone="warning">{reopenNotice}</Alert>}

          {/* E6. The only correction path this surface has, because auto-close
              removed the pause a mistake would have been caught in. */}
          <Button
            tone="secondary"
            disabled={reopen.isPending}
            onClick={() => {
              setReopenNotice(null);
              reopen.mutate(
                { workId, expectedVersion: parcel.version },
                {
                  onSuccess: (result) => {
                    setReopenNotice(
                      result.outcome === 'refused'
                        ? describeReopenRefusal(result.reason)
                        : benchParcelCopy.closed.reopenedNotice
                    );
                  },
                  onError: () => {
                    setReopenNotice(benchParcelCopy.closed.reopenFailed);
                  },
                }
              );
            }}
          >
            {benchParcelCopy.closed.reopenAction}
          </Button>
          <p className="bench-parcel__reopen-hint">{benchParcelCopy.closed.reopenHint}</p>

          {/* Surface F opens with the box. */}
          <BenchDocumentsPanel workId={workId} unitsPacked={totals.verified} />
        </div>
      ) : (
        <ul className="bench-parcel__lines">
          {parcel.lines.map((line) => (
            <BenchParcelLineRow
              key={line.workLineId}
              line={line}
              open={!refused}
              busy={verify.isPending}
              pendingCount={inFlight[line.workLineId] ?? 0}
              unreachable={reachability.unreachable}
              // E4 sends exactly what a scan sends, through the SAME mint. The
              // id therefore has the identical shape, and the request the
              // identical body — D20 by construction rather than by discipline.
              onConfirm={(target) => {
                sequence.current += 1;
                const gesture = beginGesture(target.workLineId, Date.now());
                submit(target, gesture.gestureId, sequence.current);
              }}
            />
          ))}
        </ul>
      )}

      {/* E5's promise. Rendered while verifying, where the missing button is. */}
      {closed ? null : (
        <footer className="bench-parcel__footer">
          <span>{benchParcelCopy.footer.noCommit}</span>
          <span className="bench-parcel__footer-right">
            {/* C4. Silencing the bench must not silence the screen — the mute
                reaches `bench-scan-sound` and nothing else, so every refusal
                still renders. `bench-scan-sound.test.tsx` compares the markup
                with sound on and off and requires it identical. */}
            <Button
              tone="ghost"
              onClick={() => {
                const next = !muted;
                setBenchAudioMuted(next);
                setMuted(next);
                // A short confirmation the packer can hear, so switching the
                // sound ON tells them it works without waiting for a refusal.
                // `confirm`, never a refusal signature: hearing the over-scan
                // tone as a "sound is on" chirp is exactly what would stop it
                // meaning "this box already has enough of these".
                if (!next) playScanSound('confirm');
              }}
            >
              {muted ? benchParcelCopy.audio.unmuteAction : benchParcelCopy.audio.muteAction}
            </Button>
            <span className="bench-parcel__audio-state">
              {muted ? benchParcelCopy.audio.offLabel : benchParcelCopy.audio.onLabel}
            </span>
            <span>{benchParcelCopy.footer.scannerReady}</span>
          </span>
        </footer>
      )}
    </section>
  );
}
