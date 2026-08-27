/**
 * Return Custody Panel (#2380)
 *
 * Hosts the per-line receive and dispose flows, and the `Receive all as
 * advised` bulk affordance (returns spec § 5.2 / § 5.3).
 *
 * **The forms live in the table's own expansion panel.** Expanding a line IS
 * choosing to act on it, so the panel opens on whichever flow the line is
 * waiting for — receive while units are still outstanding, dispose once they
 * have arrived — and the operator switches with one control. That keeps the
 * common case (a parcel matching what was advised) at expand-then-submit, with
 * the advised quantities on the row above still visible while typing, which is
 * what § 5.2 asks for.
 *
 * **The bulk pre-fill requires an explicit confirm**, and the confirm says what
 * it will do. It is the single most common real interaction and it records real
 * arrivals on every outstanding line; a one-click version of that is a mistake
 * an operator cannot undo from this screen.
 *
 * **A refused restock is surfaced in place, not only as a toast.** § 5.4's full
 * treatment is a sibling issue, but a disposition whose stock write silently
 * no-ops is worse than none — and a failure living in a toast dismissed while
 * looking at a parcel is the same failure with extra steps.
 *
 * @module apps/web/src/features/returns/components
 */
import { useState, type ReactElement, type ReactNode } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReturnLinesTable } from './return-lines-table';
import { ReturnReceiveForm } from './return-receive-form';
import { ReturnDisposeForm } from './return-dispose-form';
import { ReturnNotReturnedAction } from './return-not-returned-action';
import { describeCustodyError } from '../lib/custody-error';
import {
  RETURN_DISPOSE_COPY,
  RETURN_RECEIVE_COPY,
  RETURN_NOT_RETURNED_COPY,
  RETURN_RESTOCK_BLOCKED_COPY,
} from '../lib/return-custody.copy';
import { outstandingToDispose, outstandingToReceive } from '../lib/return-line-quantities';
import {
  useDisposeReturnLineMutation,
  useMarkReturnLineNotReturnedMutation,
  useReceiveReturnLineMutation,
} from '../hooks/use-return-custody-mutations';
import type { ReturnDetail, ReturnLine, ReturnRestockBlocked } from '../api/returns.types';

interface ReturnCustodyPanelProps {
  detail: ReturnDetail;
  sourceName?: string | null;
  /**
   * Resolved by the page and passed in, exactly as `ReturnDeclineAction` takes
   * it — one `useWriteAccess('orders:write', demoMode)` per page, so the two
   * write surfaces on this screen cannot disagree about the session.
   */
  writeAccess: { canWrite: boolean; demoReadOnly: boolean; visible: boolean };
}

type FlowMode = 'receive' | 'dispose';

export function ReturnCustodyPanel({
  detail,
  sourceName = null,
  writeAccess,
}: ReturnCustodyPanelProps): ReactElement {
  const { showToast } = useToast();

  const receive = useReceiveReturnLineMutation(detail.id);
  const dispose = useDisposeReturnLineMutation(detail.id);
  const markNotReturned = useMarkReturnLineNotReturnedMutation(detail.id);

  const [modeByLine, setModeByLine] = useState<Record<string, FlowMode>>({});
  /**
   * Which line a custody write is currently in flight for.
   *
   * The three mutations are one instance each for the whole panel, so their
   * `isPending` is true for every expanded row while ONE row submits — a row
   * rendering a spinner for a submission happening on a different row is the UI
   * asserting something the backend never said. The mutation identity already
   * distinguishes WHICH act, so a single line id is enough to key all three.
   */
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  const [errorByLine, setErrorByLine] = useState<Record<string, string>>({});
  /**
   * Refused restocks observed on THIS page visit.
   *
   * It deliberately never clears within a session: what resolves a block is the
   * operator attestation (`POST .../mark-stock-handled`, spec § 5.4), which is
   * the sibling issue to this one. Until that ships the flag is
   * correct-but-incomplete rather than wrong — do not "fix" it into a flag that
   * clears on nothing, which would hide a stock write that did not happen.
   */
  const [blockedByLine, setBlockedByLine] = useState<Record<string, ReturnRestockBlocked>>({});
  const [bulkOpen, setBulkOpen] = useState(false);

  const isOrphan = detail.bucket === 'orphan';
  const outstandingLines = detail.lines.filter((line) => outstandingToReceive(line) > 0);

  const setError = (lineId: string, message: string | null): void => {
    setErrorByLine((current) => {
      const next = { ...current };
      if (message === null) delete next[lineId];
      else next[lineId] = message;
      return next;
    });
  };

  const runReceive = (line: ReturnLine, input: { quantity: number; note?: string }): void => {
    setError(line.id, null);
    setPendingLineId(line.id);
    receive.mutate(
      { lineId: line.id, input },
      {
        onSuccess: () => showToast({ tone: 'success', description: RETURN_RECEIVE_COPY.success }),
        onError: (error) => setError(line.id, describeCustodyError(error)),
        onSettled: () => setPendingLineId(null),
      }
    );
  };

  const runDispose = (
    line: ReturnLine,
    input: { quantity: number; disposition: 'restock' | 'scrap'; note?: string }
  ): void => {
    setError(line.id, null);
    setPendingLineId(line.id);
    dispose.mutate(
      { lineId: line.id, input },
      {
        onSuccess: (result) => {
          // A block is NOT an error — the disposition landed. It is recorded in
          // place so the operator sees it after the toast is gone.
          setBlockedByLine((current) =>
            result.restockBlocked === null
              ? current
              : { ...current, [line.id]: result.restockBlocked }
          );
          showToast({ tone: 'success', description: RETURN_DISPOSE_COPY.success });
        },
        onError: (error) => setError(line.id, describeCustodyError(error)),
        onSettled: () => setPendingLineId(null),
      }
    );
  };

  const runMarkNotReturned = (line: ReturnLine, input: { note?: string }): void => {
    setError(line.id, null);
    setPendingLineId(line.id);
    markNotReturned.mutate(
      { lineId: line.id, input },
      {
        onSuccess: () =>
          showToast({ tone: 'success', description: RETURN_NOT_RETURNED_COPY.success }),
        onError: (error) => setError(line.id, describeCustodyError(error)),
        onSettled: () => setPendingLineId(null),
      }
    );
  };

  /**
   * Record every outstanding line as fully arrived.
   *
   * Sequential rather than parallel: each is a real arrival act against a row
   * the server locks, and firing N at once turns an ordinary contention refusal
   * into a partial batch nobody can read back. A failure stops nothing — the
   * lines that succeeded stay recorded, which is the honest outcome for acts
   * that really did happen.
   *
   * **Known cost, deliberately not optimised here.** Every `mutateAsync`
   * settles through the shared invalidation, so 20 outstanding lines produce
   * ~40 invalidations and up to 20 detail refetches inside one confirm. The fix
   * would trade the three custody mutations' single shared invalidation
   * contract for a bulk-scoped exception, and a quiet divergence between them
   * is a worse defect than redundant refetches on a confirm the operator is
   * already waiting through. Follow-up, not a silent local deviation.
   */
  const runBulkReceive = async (): Promise<void> => {
    setBulkOpen(false);
    let failed = 0;

    for (const line of outstandingLines) {
      // Keyed to the line actually being written, so a row's spinner always
      // describes that row — including mid-bulk.
      setPendingLineId(line.id);
      try {
        await receive.mutateAsync({
          lineId: line.id,
          input: { quantity: outstandingToReceive(line) },
        });
      } catch (error) {
        failed += 1;
        setError(line.id, describeCustodyError(error));
      }
    }
    setPendingLineId(null);

    showToast(
      failed === 0
        ? { tone: 'success', description: RETURN_RECEIVE_COPY.bulkSuccess }
        : { tone: 'error', description: RETURN_RECEIVE_COPY.bulkPartial }
    );
  };

  const renderCustody = (line: ReturnLine): ReactNode => {
    const canReceive = outstandingToReceive(line) > 0;
    const canDispose = outstandingToDispose(line) > 0;
    // Opens on whatever the line is waiting for, so the common case is one
    // press to expand and one to submit.
    const mode: FlowMode = modeByLine[line.id] ?? (canReceive ? 'receive' : 'dispose');
    const blocked = blockedByLine[line.id];
    const error = errorByLine[line.id] ?? null;

    return (
      <ReadOnlyLock active={writeAccess.demoReadOnly} message={RETURN_RECEIVE_COPY.readOnly}>
        <div className="return-custody-detail">
          {blocked !== undefined ? (
            <Alert tone="error">
              <strong>{RETURN_RESTOCK_BLOCKED_COPY.title}</strong>{' '}
              {RETURN_RESTOCK_BLOCKED_COPY.bodyPrefix}{' '}
              <strong>
                {blocked.connectionName ?? RETURN_RESTOCK_BLOCKED_COPY.bodyUnknownConnection}
              </strong>{' '}
              {RETURN_RESTOCK_BLOCKED_COPY.bodySuffix} {RETURN_RESTOCK_BLOCKED_COPY.remedyPrefix}{' '}
              {blocked.quantity} {RETURN_RESTOCK_BLOCKED_COPY.remedyJoin}{' '}
              {blocked.sku ?? line.sku ?? RETURN_RESTOCK_BLOCKED_COPY.bodyUnknownConnection}{' '}
              {RETURN_RESTOCK_BLOCKED_COPY.remedySuffix}
            </Alert>
          ) : null}

          {canReceive && canDispose ? (
            <div className="return-custody-detail__switch">
              <Button
                onClick={() => setModeByLine((current) => ({ ...current, [line.id]: 'receive' }))}
                type="button"
                tone={mode === 'receive' ? 'primary' : 'secondary'}
              >
                {RETURN_RECEIVE_COPY.action}
              </Button>
              <Button
                onClick={() => setModeByLine((current) => ({ ...current, [line.id]: 'dispose' }))}
                type="button"
                tone={mode === 'dispose' ? 'primary' : 'secondary'}
              >
                {RETURN_DISPOSE_COPY.action}
              </Button>
            </div>
          ) : null}

          {mode === 'receive' && canReceive ? (
            <ReturnReceiveForm
              error={error}
              line={line}
              onCancel={() => setError(line.id, null)}
              onSubmit={(input) => runReceive(line, input)}
              pending={receive.isPending && pendingLineId === line.id}
            />
          ) : null}

          {mode === 'dispose' && canDispose ? (
            <ReturnDisposeForm
              error={error}
              isOrphan={isOrphan}
              line={line}
              onCancel={() => setError(line.id, null)}
              onSubmit={(input) => runDispose(line, input)}
              pending={dispose.isPending && pendingLineId === line.id}
              restockTarget={detail.restockTarget}
            />
          ) : null}

          {!canReceive && !canDispose ? (
            <p className="text-muted">{RETURN_DISPOSE_COPY.nothingToDispose}</p>
          ) : null}

          <ReturnNotReturnedAction
            line={line}
            onConfirm={(input) => runMarkNotReturned(line, input)}
            pending={markNotReturned.isPending && pendingLineId === line.id}
          />
        </div>
      </ReadOnlyLock>
    );
  };

  return (
    <section className="return-custody-panel" id="custody">
      {writeAccess.visible && outstandingLines.length > 0 ? (
        <ReadOnlyLock active={writeAccess.demoReadOnly} message={RETURN_RECEIVE_COPY.bulkAction}>
          <div className="return-custody-panel__bulk">
            <Button onClick={() => setBulkOpen(true)} tone="secondary" type="button">
              {RETURN_RECEIVE_COPY.bulkAction}
            </Button>
          </div>
        </ReadOnlyLock>
      ) : null}

      <ReturnLinesTable
        lines={detail.lines}
        // `visible`, not `canWrite` — the house policy inverts between the two
        // (frontend-architecture.md § Access Control): a demo viewer is SHOWN
        // write affordances, disabled, because the point of the demo is to
        // advertise that the capability exists. Gating on `canWrite` hid the
        // per-line flows from exactly that session while the bulk action above
        // rendered locked beside them — two answers to one question.
        renderCustody={writeAccess.visible ? renderCustody : undefined}
        sourceName={sourceName}
      />

      <Dialog onOpenChange={setBulkOpen} open={bulkOpen}>
        <DialogContent>
          <DialogTitle>{RETURN_RECEIVE_COPY.bulkConfirmTitle}</DialogTitle>
          <DialogDescription>{RETURN_RECEIVE_COPY.bulkConfirmBody}</DialogDescription>
          <DialogFooter>
            <Button
              disabled={receive.isPending}
              onClick={() => void runBulkReceive()}
              type="button"
            >
              {receive.isPending ? RETURN_RECEIVE_COPY.pending : RETURN_RECEIVE_COPY.bulkConfirm}
            </Button>
            <Button onClick={() => setBulkOpen(false)} tone="secondary" type="button">
              {RETURN_RECEIVE_COPY.bulkCancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
