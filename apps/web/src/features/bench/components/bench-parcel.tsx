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
import { formatAmount } from '../../../shared/format/format-amount';
import type { BenchParcel, BenchParcelLine } from '../api/bench-parcel.types';
import { useBenchInteractive } from '../hooks/use-bench-interactive';
import { useBenchParcelQuery } from '../hooks/use-bench-parcel-query';
import { useBenchReachability, isUnreachableFailure } from '../hooks/use-bench-reachability';
import { useBenchReopenMutation } from '../hooks/use-bench-reopen-mutation';
import { useBenchUndoMutation } from '../hooks/use-bench-undo-mutation';
import { useBenchVerifyMutation } from '../hooks/use-bench-verify-mutation';
import { useScannerInput } from '../hooks/use-scanner-input';
import { describeBenchDeadline } from '../lib/bench-work-presentation';
import {
  benchLineState,
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
import { isEditableTarget } from '../lib/scanner-gesture';
import { beginGesture } from '../lib/scanner-gesture-log';
import { BenchActivityPanel } from './bench-activity-panel';
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
  const undo = useBenchUndoMutation();
  const reachability = useBenchReachability();
  // A3. False while the idle lock or the handover prompt covers the bench.
  const interactive = useBenchInteractive();

  const [notice, setNotice] = useState<ScanNotice | null>(null);
  const [interrupted, setInterrupted] = useState<string | null>(null);
  const [reopenNotice, setReopenNotice] = useState<string | null>(null);
  const [undoNotice, setUndoNotice] = useState<string | null>(null);
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

  /**
   * The newest gesture the live region has spoken for (#2905 review).
   *
   * The cache write is guarded on `version` and the refusal on `seq`, but the
   * ACCEPTANCE announcement was not — so with two gestures out and the older
   * answer landing last, the visible line correctly read *2 of 2* while the
   * live region then said *"recorded, 1 of 2"*. Nothing sighted is affected,
   * which is exactly why it matters: this is the only channel a non-sighted
   * packer has, and under D18 the box has already shut, so no later correction
   * arrives to overwrite it.
   *
   * The IN-FLIGHT announcement needs no guard — it is written before the
   * request, so it is newest by construction; it advances this mark instead.
   */
  const announcedSeq = useRef(0);

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
    announcedSeq.current = seq;
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
        //
        // Guarded on `seq`, exactly as the refusal below is: `answered` is THIS
        // gesture's own count, so an older answer landing last would announce a
        // lower count than the screen holds.
        if (seq >= announcedSeq.current) {
          announcedSeq.current = seq;
          setAnnouncement(
            benchParcelCopy.inFlight.recordedAnnouncement({
              name: lineName(line),
              verified: answered?.verifiedQuantity ?? 0,
              required: answered?.requiredQuantity ?? 0,
            })
          );
        }
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

  const scannerInput = useScannerInput({
    // Off while the box is closed, refused or still loading: a scan made then
    // has nothing it could legitimately record, and accepting it would be the
    // surface pretending to work.
    //
    // And off while the bench is LOCKED (A3) — the cached parcel outlives the
    // session, so without this a scan at an unattended terminal is attributed
    // to whoever walked away. See `use-bench-interactive.ts`.
    enabled: interactive && parcel !== undefined && !closed && !refused,
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

  /**
   * "C" hand-confirms the first not-yet-satisfied line — a keyboard
   * equivalent of pressing the topmost visible "Confirm this line" button
   * (#3339, mockup fix). Deliberately NOT a full ShipStation-style hotkey
   * set: the mockup also demonstrated "U" (undo) and "N" (take next task),
   * but neither has a real counterpart here — this app has no undo
   * capability at all (scans are append-only, matching the codebase's
   * general act-ledger discipline), and "take next task" lives in a sibling
   * component this one does not reach. Inventing either would be UI with no
   * capability behind it.
   *
   * Same enabled-gate as the scanner listener above (`interactive && !closed
   * && !refused`). While unreachable, the shortcut raises the SAME
   * `unreachable` notice the scan path does two dozen lines up — a shown
   * control with no feedback would be the one way to record a unit that
   * never says why it failed (#3339 review).
   *
   * ## Why the scanner burst check exists, and why capture-phase (#3339 review)
   *
   * `useScannerInput`'s own module docblock is explicit that its listener is
   * on `document` and needs no focused element — which means DURING A SCAN
   * there is no focused element either, `isEditableTarget` returns `false`
   * for the document body, and a scanned value containing a stray "c"/"C"
   * (SKU scanning against alphanumeric codes is normal here) would otherwise
   * pass every guard below and hand-confirm a line nobody scanned.
   *
   * `scannerInput.isBurstInProgress()` guards against that by reading
   * `useScannerInput`'s own keystroke buffer. Registering THIS listener with
   * `{ capture: true }` is what makes the check answer the right question:
   * capture-phase listeners on `document` run before bubble-phase ones for
   * the same event, so this handler sees the buffer as it stood BEFORE the
   * scanner hook (a plain, bubble-phase listener) appends the current
   * keystroke — i.e. "was a burst already under way", not "does the buffer
   * now contain this keystroke" (which would be true for every press,
   * including a genuine standalone "C").
   *
   * No `preventDefault()` — the scanner hook declines it on purpose (see its
   * module docblock), and a plain "c" keypress with nothing focused has no
   * browser default to suppress anyway.
   */
  useEffect(() => {
    if (!interactive || closed || refused) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'c') return;
      if (scannerInput.isBurstInProgress()) return;

      if (reachabilityRef.current) {
        sequence.current += 1;
        raise({ seq: sequence.current, kind: 'unreachable' }, 'unreachable');
        return;
      }

      const current = parcelRef.current;
      if (current === undefined) return;
      const next = current.lines.find((candidate) => benchLineState(candidate) !== 'verified');
      if (next === undefined) return;

      sequence.current += 1;
      const gesture = beginGesture(next.workLineId, Date.now());
      submit(next, gesture.gestureId, sequence.current);
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
    // Deliberate dep list: this project's ESLint config carries no
    // `react-hooks/exhaustive-deps` rule (verified via `pnpm lint`), so there
    // is no suppression to add. `submit`/`raise` close over state via refs
    // (parcelRef/reachabilityRef) by the same convention useScannerInput's
    // onScan above uses; `scannerInput.isBurstInProgress` is a `useCallback`
    // with an empty dep list and is therefore stable across renders, the
    // same reason `settle` needs no entry either. Re-running per parcel
    // change would thrash the listener on every poll tick.
  }, [interactive, closed, refused]);

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
        {/* D3. Always shown, on every state — never conditional like the
            fields below it. Rendered as a FIELD (#3418), matching the
            mockup's own Order/Buyer/Parcel/Total/Carrier/Ship-by row, rather
            than the badge it was before; the parcel-index STATUS pill is the
            state signal now, so a badge here would duplicate that role. */}
        <div className="bench-parcel__identity">
          <span className="eyebrow">{benchParcelCopy.header.parcelLabel}</span>
          <span>{benchParcelCopy.header.parcelOf(parcel.parcelIndex, parcel.parcelTotal)}</span>
        </div>
        {/* #3409 (epic #3401) — a deliberate PII-exclusion reversal. */}
        {parcel.totalAmount === null ? null : (
          <div className="bench-parcel__identity">
            <span className="eyebrow">{benchParcelCopy.header.totalLabel}</span>
            <span className="bench-parcel__total">
              {formatAmount(parcel.totalAmount, parcel.currency ?? undefined)}
            </span>
          </div>
        )}
        {parcel.carrierName === null ? null : (
          <div className="bench-parcel__identity">
            <span className="eyebrow">{benchParcelCopy.header.carrierLabel}</span>
            <span>{parcel.carrierName}</span>
          </div>
        )}
        {parcel.dispatchByAt === null ? null : (
          <div className="bench-parcel__identity">
            <span className="eyebrow">{benchParcelCopy.header.dispatchByLabel}</span>
            <span>{describeBenchDeadline(parcel.dispatchByAt).headline}</span>
          </div>
        )}
        <div className="bench-parcel__header-spacer" />
        {/* #3418 — the order-head's own status pill. `pulse` only on the
            genuinely in-progress state, matching the mockup's own
            `status-badge--pulse`; a held/cancelled/packed box is a settled
            fact, not something happening right now. */}
        {parcel.refusal === 'held' ? (
          <StatusBadge tone="error" withDot>
            {benchParcelCopy.header.statusHeld}
          </StatusBadge>
        ) : parcel.refusal === 'cancelled' ? (
          <StatusBadge tone="neutral" withDot>
            {benchParcelCopy.header.statusCancelled}
          </StatusBadge>
        ) : closed ? (
          <StatusBadge tone="success" withDot>
            {benchParcelCopy.header.statusPacked}
          </StatusBadge>
        ) : (
          <StatusBadge tone="warning" pulse>
            {benchParcelCopy.header.statusInProgress}
          </StatusBadge>
        )}
        <Button tone="ghost" onClick={onClose}>
          {benchParcelCopy.header.backAction}
        </Button>
      </header>

      <p className="bench-parcel__scope">{benchParcelCopy.header.thisBoxOnly}</p>
      <div className="bench-parcel__progress-row">
        <p className="bench-parcel__progress">
          {benchParcelCopy.header.progress(totals.verified, totals.required)}
        </p>
        {/* #3405. Undoes the single most recent scan, whichever line it
            landed on — there is no per-line target to name, so this is one
            control rather than a button repeated on every row. Offered only
            on an OPEN box (a closed one is `reopenParcel`'s job). */}
        {closed ? null : (
          <Button
            tone="ghost"
            disabled={undo.isPending}
            onClick={() => {
              setUndoNotice(null);
              undo.mutate(workId, {
                onSuccess: (result) => {
                  if (result.outcome === 'refused') {
                    setUndoNotice(
                      result.reason === 'parcel-closed'
                        ? benchParcelCopy.undo.parcelClosed
                        : benchParcelCopy.undo.nothingToUndo
                    );
                    return;
                  }
                  const lineName =
                    result.parcel.lines.find((l) => l.workLineId === result.workLineId)?.name ??
                    null;
                  setUndoNotice(benchParcelCopy.undo.voidedNotice(lineName));
                },
              });
            }}
          >
            {benchParcelCopy.undo.action}
          </Button>
        )}
      </div>
      {undoNotice === null ? null : (
        <p className="bench-parcel__undo-notice" role="status" data-testid="bench-parcel-undo-notice">
          {undoNotice}
        </p>
      )}

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

      {/* #3411 (epic #3401). Rendered on every state — activity happened
          throughout packing, not only once the box is open. */}
      <BenchActivityPanel workId={workId} />

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
            <span>{benchParcelCopy.footer.keyboardHint}</span>
          </span>
        </footer>
      )}
    </section>
  );
}
