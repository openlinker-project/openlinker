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
 * @module apps/web/src/features/bench/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BenchParcel, BenchParcelLine } from '../api/bench-parcel.types';
import { useBenchParcelQuery } from '../hooks/use-bench-parcel-query';
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
import { matchScanToParcelLine, outstandingScanCodes } from '../lib/parcel-scan-match';
import { beginGesture } from '../lib/scanner-gesture-log';
import { BenchDocumentsPanel } from './bench-documents';
import { BenchParcelLineRow } from './bench-parcel-line';

export interface BenchParcelProps {
  readonly workId: string;
  /** Leaving this box. The bench's only exit from the parcel, per story C2. */
  readonly onClose: () => void;
}

/** What the surface is currently telling the packer about their last gesture. */
type ScanNotice =
  | { readonly kind: 'wrong-item'; readonly scanned: string; readonly expected: readonly string[] }
  | { readonly kind: 'refused'; readonly message: string; readonly overPacked: boolean }
  | { readonly kind: 'failed' };

export function BenchParcelView({ workId, onClose }: BenchParcelProps): ReactElement {
  const query = useBenchParcelQuery(workId);
  const verify = useBenchVerifyMutation();
  const reopen = useBenchReopenMutation();

  const [notice, setNotice] = useState<ScanNotice | null>(null);
  const [interrupted, setInterrupted] = useState<string | null>(null);
  const [reopenNotice, setReopenNotice] = useState<string | null>(null);

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

  const submit = (line: BenchParcelLine, gestureId: string): void => {
    verify.mutate(
      { workId, workLineId: line.workLineId, gestureId },
      {
        onSuccess: (result) => {
          if (result.outcome === 'refused') {
            setNotice({
              kind: 'refused',
              message: describeVerificationRefusal(
                result.reason,
                result.parcel.lines.find((candidate) => candidate.workLineId === line.workLineId)
              ),
              overPacked: result.reason === 'over-packed',
            });
            return;
          }
          setNotice(null);
        },
        onError: () => {
          setNotice({ kind: 'failed' });
        },
      }
    );
  };

  useScannerInput({
    // Off while the box is closed, refused or still loading: a scan made then
    // has nothing it could legitimately record, and accepting it would be the
    // surface pretending to work.
    enabled: parcel !== undefined && !closed && !refused,
    onScan: (gesture) => {
      const current = parcelRef.current;
      if (current === undefined) return;

      const match = matchScanToParcelLine(current, gesture.value);
      if (match.kind === 'matched') {
        submit(match.line, gesture.gestureId);
        return;
      }

      // E2/E3 answered in the browser. Nothing is sent, and nothing is
      // recorded — including the gesture id, which stays pending because no
      // server ever saw it.
      if (match.kind === 'already-full') {
        setNotice({
          kind: 'refused',
          message: benchParcelCopy.verify.overPacked({
            required: match.line.requiredQuantity,
            kept: match.line.verifiedQuantity,
          }),
          overPacked: true,
        });
        return;
      }

      setNotice({
        kind: 'wrong-item',
        scanned: gesture.value,
        expected: outstandingScanCodes(current),
      });
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
                ? benchParcelCopy.verify.failedTitle
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
            benchParcelCopy.verify.failedBody
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
              // E4 sends exactly what a scan sends, through the SAME mint. The
              // id therefore has the identical shape, and the request the
              // identical body — D20 by construction rather than by discipline.
              onConfirm={(target) => {
                const gesture = beginGesture(target.workLineId, Date.now());
                submit(target, gesture.gestureId);
              }}
            />
          ))}
        </ul>
      )}

      {/* E5's promise. Rendered while verifying, where the missing button is. */}
      {closed ? null : (
        <footer className="bench-parcel__footer">
          <span>{benchParcelCopy.footer.noCommit}</span>
          <span>{benchParcelCopy.footer.scannerReady}</span>
        </footer>
      )}
    </section>
  );
}
