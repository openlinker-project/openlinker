/**
 * Order Correction Proposal Dialog (#3541, mockup M1 `cancel-done`)
 *
 * Shows the credit proposal a cancelled, invoiced order left behind - the lines
 * going to zero and the document they correct - and confirms it. Since #3544 it
 * serves the second correction kind too, `order.discount_correction`: the same
 * confirm act, but the lines carry a new unit price instead of a new quantity,
 * and only the session that saved the discount holds them (the server's list of
 * open proposals names the document, not the lines), so a reloaded page shows
 * the document and says so rather than inventing figures. Confirming
 * issues the correcting invoice, which cannot be withdrawn once a tax authority
 * has it, so the dialog says that before the button and never confirms on its own.
 *
 * Errors render as the server states them, titled by machine code. A provider
 * failure (422 `CORRECTION_FAILED`) leaves the proposal open on the server, so
 * the button stays for a retry; a proposal that is already confirmed, expired or
 * no longer open cannot be confirmed again, so the button goes.
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useToast } from '../../../shared/ui/toast-provider';
import type {
  CancelCorrectionProposal,
  ConfirmOrderChangeResult,
} from '../api/order-cancel.types';
import type { DiscountCorrectionLine } from '../api/order-edit.types';
import { useConfirmOrderChangeMutation } from '../hooks/use-confirm-order-change-mutation';
import {
  CONFIRM_CORRECTION_ERROR_TITLES,
  readOrderCancelErrorCode,
  readServerReason,
  type OrderCancelErrorCode,
} from '../lib/order-cancel';

/** Codes after which confirming again can never succeed. */
const NOT_RETRYABLE: readonly OrderCancelErrorCode[] = [
  'CHANGE_ALREADY_CONFIRMED',
  'CHANGE_EXPIRED',
  'CHANGE_NOT_OPEN',
  'CHANGE_KIND_NOT_CONFIRMABLE',
  'CORRECTION_IN_PROGRESS',
  'CORRECTION_NEEDS_RECONCILIATION',
  'CORRECTION_SUPERSEDED',
];

export interface OrderCorrectionProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  internalOrderId: string;
  proposal: CancelCorrectionProposal;
  /** Which correction this is. Defaults to the cancel credit proposal. */
  kind?: 'order.cancel_correction' | 'order.discount_correction';
  /** `order.discount_correction` only: the repriced lines, when this session saved the discount. */
  priceLines?: readonly DiscountCorrectionLine[] | null;
  onConfirmed: (result: ConfirmOrderChangeResult) => void;
}

export function OrderCorrectionProposalDialog({
  open,
  onOpenChange,
  internalOrderId,
  proposal,
  kind = 'order.cancel_correction',
  priceLines = null,
  onConfirmed,
}: OrderCorrectionProposalDialogProps): ReactElement {
  const discount = kind === 'order.discount_correction';
  const { showToast } = useToast();
  const mutation = useConfirmOrderChangeMutation();
  // The confirm route is admin-only; everyone else reads the proposal.
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const isAdmin = useIsAdmin();
  const canConfirm = write.canWrite && isAdmin;
  // A previous attempt's error must not greet the next open.
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) resetMutation();
  }, [open, resetMutation]);

  const errorCode = mutation.isError ? readOrderCancelErrorCode(mutation.error) : null;
  const retryable = errorCode === null || !NOT_RETRYABLE.includes(errorCode);

  const confirm = (): void => {
    mutation.mutate(
      { internalOrderId, changeId: proposal.changeId },
      {
        onSuccess: (result) => {
          showToast({ tone: 'success', description: 'Correction confirmed.' });
          onConfirmed(result);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="order-hold-dialog"
        data-testid={discount ? 'order-edit-correction-dialog' : 'order-correction-dialog'}
      >
        <DialogTitle>
          {proposal.documentNumber
            ? `Correction for ${proposal.documentNumber}`
            : 'Correction invoice'}
        </DialogTitle>
        <DialogDescription>
          {discount
            ? 'The order was discounted, so the invoice is corrected to the discounted prices. Confirming issues the correcting invoice, and an issued correction can not be withdrawn.'
            : 'The order was cancelled, so every line of the invoice goes to zero. Confirming issues the correcting invoice, and an issued correction can not be withdrawn.'}
        </DialogDescription>

        {mutation.isError ? (
          <Alert
            tone="error"
            title={(errorCode ? CONFIRM_CORRECTION_ERROR_TITLES[errorCode] : undefined) ?? 'Could not confirm the correction'}
            data-testid="order-correction-error"
          >
            {readServerReason(mutation.error, 'Could not confirm the correction.')}
          </Alert>
        ) : null}

        {discount ? (
          priceLines && priceLines.length > 0 ? (
            <div className="data-table__container" data-testid="order-correction-lines">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Product</th>
                    <th>Unit price</th>
                  </tr>
                </thead>
                <tbody>
                  {priceLines.map((line) => (
                    <tr key={line.originalLineNumber}>
                      <td className="mono-text">{line.originalLineNumber}</td>
                      <td>{line.name}</td>
                      <td className="mono-text order-cancel-diff">
                        <del>{line.previousUnitPriceGross.toFixed(2)}</del>{' '}
                        <ins>{line.newUnitPriceGross.toFixed(2)}</ins>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted-text" data-testid="order-correction-lines-unavailable">
              The repriced lines were shown when the discount was saved and are not kept on this page.
              Confirming issues the correction OpenLinker drafted then.
            </p>
          )
        ) : (
          <div className="data-table__container" data-testid="order-correction-lines">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Product</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {proposal.lines.map((line) => (
                  <tr key={line.originalLineNumber}>
                    <td className="mono-text">{line.originalLineNumber}</td>
                    <td>{line.name}</td>
                    <td className="mono-text order-cancel-diff">
                      <del>{line.previousQuantity}</del> <ins>{line.newQuantity}</ins>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="secondary" disabled={mutation.isPending}>
              Close
            </Button>
          </DialogClose>
          {retryable && (canConfirm || write.demoReadOnly) ? (
            <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <Button
              type="button"
              tone="primary"
              disabled={mutation.isPending || write.demoReadOnly}
              data-testid="order-correction-confirm"
              onClick={confirm}
            >
              {mutation.isPending ? 'Confirming…' : 'Confirm correction'}
            </Button>
            </ReadOnlyLock>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
