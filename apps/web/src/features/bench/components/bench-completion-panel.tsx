/**
 * Pack-bench completion — the second, explicit act after a box closes
 *
 * A closed parcel says the ITEMS are right. Everything after that — the
 * label stuck on, the invoice inside, and eventually the box actually
 * leaving — was previously invisible, and a packer who forgot to print was
 * never told so. Industry practice (ShipHero's "Complete Order",
 * Brightpearl's `Packed` state before `Shipped`) treats that as its own
 * step, separate from printing. So does this: one control, offered only
 * once the box is closed and not yet marked done, with a real write behind
 * it — distinct from D18's rule, which is about the box's CONTENTS closing
 * with nothing to press, not about this later question.
 *
 * ## It says "off the bench", never "sent" or "labelled" — on PURPOSE
 *
 * A box the carrier refused a label for renders `BenchDocumentsPanel`'s own
 * "this box cannot go out" a few lines above this control. Wording that
 * claimed the box was labelled and on its way would be false there, and a
 * packer pressing the button would have just told the office something
 * untrue. `completedAt` records that the PACKER is finished with the box —
 * an honest fact whether the carrier ever gave it a label or not — never a
 * claim that it left the building. `BenchLabel.state === 'unavailable'` is
 * how the panel above tells the two apart; this control does not need to,
 * because its copy makes no claim either reading could falsify.
 *
 * ## Goes straight through when there is nothing to ask about
 *
 * The confirm only appears when a document that COULD have been printed
 * never was — `state === 'ready'` on the current documents read, and the
 * matching `*PrintedAt` on the parcel still `null`. A document that is
 * missing or not printable (an unavailable label included) is never named
 * here: there is nothing this bench could print for it, and asking about it
 * would send the packer looking for a control that does not exist. When
 * neither gap applies, pressing the button completes the parcel immediately.
 *
 * ## The confirm never blocks a packer who already printed elsewhere
 *
 * Its body offers the print action AND an "anyway" action that proceeds
 * regardless — a packer who printed from another terminal, or simply forgot,
 * must be able to finish in one more press rather than being stuck reading a
 * warning it cannot act on.
 *
 * ## Taking it back (#3415) is not the reopen
 *
 * A completion used to be a one-way door — `reopen` was the only route
 * back, and it UNPACKS the box, so a packer who marked the wrong parcel
 * done had to re-scan one that was already correct. The completed branch
 * below therefore offers its own, lighter control that clears `completedAt`
 * alone; every scan and the closed box stand untouched.
 *
 * @module apps/web/src/features/bench/components
 */
import { useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { formatAbsoluteTime } from '../../../shared/format/format-date';
import type { BenchParcel } from '../api/bench-parcel.types';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import { useBenchCompleteMutation } from '../hooks/use-bench-complete-mutation';
import { useBenchUndoCompletionMutation } from '../hooks/use-bench-undo-completion-mutation';
import { useBenchDocumentsQuery } from '../hooks/use-bench-documents-query';
import {
  completionPrintGaps,
  describeCompletionRefusal,
  describeUndoCompletionRefusal,
} from '../lib/bench-parcel-presentation';
import { benchParcelCopy } from '../lib/bench-parcel.copy';
import { printBlob } from '../lib/bench-print';

export interface BenchCompletionPanelProps {
  readonly workId: string;
  /** The parcel AS RENDERED — its `version` is what a completion is sent against. */
  readonly parcel: BenchParcel;
  /**
   * Called once the parcel is genuinely finished: on `outcome === 'completed'`,
   * and on an `already-completed` refusal, which means the same thing arrived
   * a moment too late. Never called on `not-closed`, `version-conflict` or
   * `not-claimable-by-viewer` — those are reasons to stay and read the notice.
   */
}

export function BenchCompletionPanel({
  workId,
  parcel,
}: BenchCompletionPanelProps): ReactElement {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const documents = useBenchDocumentsQuery(workId);
  const complete = useBenchCompleteMutation();
  const undoCompletion = useBenchUndoCompletionMutation();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [undoNotice, setUndoNotice] = useState<string | null>(null);

  if (parcel.completedAt !== null) {
    // Offered ONLY here — a completed box is the sole state this control
    // means anything for. Pressing it clears `completedAt` alone (never
    // touching a scan), so on success the parcel re-renders below this
    // branch's own guard and the ordinary completion action reappears.
    const runUndo = (): void => {
      setUndoNotice(null);
      undoCompletion.mutate(
        { workId, expectedVersion: parcel.version },
        {
          onSuccess: (result) => {
            // `result.parcel` already replaced the cache (the mutation
            // hook's own `setQueryData`), so a real `undone` falls straight
            // out of this branch on the next render — nothing left to do
            // here but let a refusal speak.
            if (result.outcome === 'undone') return;
            setUndoNotice(describeUndoCompletionRefusal(result.reason));
          },
          onError: () => {
            setUndoNotice(benchParcelCopy.completion.undoFailed);
          },
        }
      );
    };

    return (
      <div className="bench-parcel__completion">
        <p className="bench-parcel__completion-done" data-testid="bench-parcel-completed">
          {benchParcelCopy.completion.doneNotice(formatAbsoluteTime(parcel.completedAt))}
        </p>
        {undoNotice === null ? null : <Alert tone="warning">{undoNotice}</Alert>}
        <Button
          tone="secondary"
          disabled={undoCompletion.isPending}
          onClick={runUndo}
          data-testid="bench-parcel-undo-completion-action"
        >
          {benchParcelCopy.completion.undoAction}
        </Button>
        <p className="bench-parcel__completion-hint">{benchParcelCopy.completion.undoHint}</p>
      </div>
    );
  }

  const gaps = completionPrintGaps(parcel, documents.data);
  const hasGap = gaps.invoiceUnprinted || gaps.labelUnprinted;

  const runCompletion = (): void => {
    setNotice(null);
    complete.mutate(
      { workId, expectedVersion: parcel.version },
      {
        onSuccess: (result) => {
          if (result.outcome === 'completed' || result.reason === 'already-completed') {
            // The pane STAYS OPEN on the completed state. It used to call
            // `onCompleted`, wired straight to `onClose`, so the parcel shut
            // the moment it was marked done - and once #3415 gave a
            // completion a way back, that closed the pane on the very success
            // that would otherwise render "Take this back", making the undo
            // unreachable: `groupBenchWork` drops a completed row from both
            // rail sections, and "Packed today" is a read-only log that
            // cannot be opened. So there was no second route in.
            //
            // Nothing needs doing here now: the mutation hook already wrote
            // the fresh parcel into the cache, so this panel re-renders into
            // its completed branch on its own. The packer leaves by picking
            // their next parcel, which replaces the pane anyway.
            return;
          }
          // A refusal is a 200 carrying its own reason, never an error — the
          // parcel returned with it already replaced the cache (the mutation
          // hook's own `setQueryData`), so the surface is already showing the
          // fresh state a `version-conflict` asked the packer to re-read.
          setNotice(describeCompletionRefusal(result.reason));
        },
        onError: () => {
          setNotice(benchParcelCopy.completion.failed);
        },
      }
    );
  };

  const handlePrimaryClick = (): void => {
    if (hasGap) {
      setPrintError(null);
      setConfirmOpen(true);
      return;
    }
    runCompletion();
  };

  // Both prints re-read the PARCEL afterwards — not just the documents —
  // because `*PrintedAt` lives on the parcel and is what this panel's own gap
  // check reads. Without it, printing from inside this dialog would leave the
  // dialog telling the packer to print something it just printed.
  const refreshAfterPrint = (): void => {
    void queryClient.invalidateQueries({ queryKey: benchQueryKeys.parcel(workId) });
  };

  const printInvoice = (): void => {
    setPrintError(null);
    void apiClient.bench
      .downloadInvoice(workId)
      .then((blob) => {
        if (printBlob(blob)) refreshAfterPrint();
        else setPrintError(benchParcelCopy.completion.printFailed);
      })
      .catch(() => {
        setPrintError(benchParcelCopy.completion.printFailed);
      });
  };

  const printLabel = (): void => {
    setPrintError(null);
    const shipmentId = documents.data?.label.shipmentId ?? null;
    if (shipmentId === null) {
      setPrintError(benchParcelCopy.completion.printFailed);
      return;
    }
    // Through the WORK, never the shipment id — this is the route that
    // stamps the print (#3340), which is what this panel's own gap check
    // reads after `refreshAfterPrint()`.
    void apiClient.bench
      .downloadLabel(workId)
      .then((blob) => {
        if (printBlob(blob)) refreshAfterPrint();
        else setPrintError(benchParcelCopy.completion.printFailed);
      })
      .catch(() => {
        setPrintError(benchParcelCopy.completion.printFailed);
      });
  };

  // A fourth, explicit branch — not a fallback onto `confirmBodyLabel`. The
  // dialog re-reads the live parcel (`refreshAfterPrint`), so a packer who
  // prints BOTH from inside it sees both gaps clear while the dialog stays
  // open; folding "neither missing" into the label sentence would then tell
  // them a label is still missing when it is not (#2905-shaped review catch,
  // live-verified on the demo stack: printing the label left the dialog
  // reading "The label for this box has not been printed yet" with the print
  // button already gone).
  const confirmDescription =
    gaps.invoiceUnprinted && gaps.labelUnprinted
      ? benchParcelCopy.completion.confirmBodyBoth
      : gaps.invoiceUnprinted
        ? benchParcelCopy.completion.confirmBodyInvoice
        : gaps.labelUnprinted
          ? benchParcelCopy.completion.confirmBodyLabel
          : benchParcelCopy.completion.confirmBodyNoneLeft;

  return (
    <div className="bench-parcel__completion">
      {notice === null ? null : <Alert tone="warning">{notice}</Alert>}
      <Button
        tone="primary"
        disabled={complete.isPending}
        onClick={handlePrimaryClick}
        data-testid="bench-parcel-complete-action"
      >
        {benchParcelCopy.completion.action}
      </Button>
      <p className="bench-parcel__completion-hint">{benchParcelCopy.completion.hint}</p>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={benchParcelCopy.completion.confirmTitle}
        description={confirmDescription}
        body={
          <>
            <p>{benchParcelCopy.completion.confirmHint}</p>
            {printError === null ? null : <Alert tone="warning">{printError}</Alert>}
            <div className="bench-parcel__completion-print-actions">
              {gaps.invoiceUnprinted ? (
                <Button tone="secondary" onClick={printInvoice}>
                  {benchParcelCopy.completion.printInvoiceAction}
                </Button>
              ) : null}
              {gaps.labelUnprinted ? (
                <Button tone="secondary" onClick={printLabel}>
                  {benchParcelCopy.completion.printLabelAction}
                </Button>
              ) : null}
            </div>
          </>
        }
        confirmLabel={benchParcelCopy.completion.confirmAction}
        cancelLabel={benchParcelCopy.completion.cancelAction}
        isConfirming={complete.isPending}
        onConfirm={() => {
          setConfirmOpen(false);
          runCompletion();
        }}
      />
    </div>
  );
}
