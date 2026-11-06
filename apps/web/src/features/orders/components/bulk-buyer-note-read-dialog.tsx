/**
 * Bulk Mark Buyer Message Read Dialog (#3619, mockup M3 `bulk`)
 *
 * Applies only to selected orders that carry an unread buyer message (the list
 * already says which). The rest are never sent and are reported as skipped in
 * the same result view, next to the backend's own per-row outcomes
 * (`marked | already-read | no-note | not-found | failed`).
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import type { BulkBuyerNoteReadResult } from '../api/order-bulk-actions.types';
import type { OrderRecord } from '../api/orders.types';
import { useBulkMarkBuyerNoteReadMutation } from '../hooks/use-bulk-order-actions';
import { useMessages, usePlural } from '../../../shared/i18n';
import { bulkNoteRow, splitBuyerNoteCandidates } from '../lib/bulk-order-actions';
import { readServerReason } from '../lib/order-cancel';
import { BulkResultRows, type BulkResultRow } from './bulk-result-rows';

export interface BulkBuyerNoteReadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: readonly OrderRecord[];
  onComplete?: () => void;
}

export function BulkBuyerNoteReadDialog({
  open,
  onOpenChange,
  orders,
  onComplete,
}: BulkBuyerNoteReadDialogProps): ReactElement {
  const mutation = useBulkMarkBuyerNoteReadMutation();
  const copy = useMessages('orders').bulkActions;
  const COPY = copy.read;
  const plural = usePlural();
  const [result, setResult] = useState<BulkBuyerNoteReadResult | null>(null);
  const [skipped, setSkipped] = useState<BulkResultRow[]>([]);
  const { reset: resetMutation } = mutation;
  const split = useMemo(() => splitBuyerNoteCandidates(orders), [orders]);
  const skipCount = split.noNote.length + split.alreadyRead.length;

  useEffect(() => {
    if (open) {
      resetMutation();
      setResult(null);
      setSkipped([]);
    }
  }, [open, resetMutation]);

  function run(): void {
    const skippedRows: BulkResultRow[] = [
      ...split.noNote.map((o) => ({
        orderId: o.internalOrderId,
        ...bulkNoteRow('no-note', copy),
      })),
      ...split.alreadyRead.map((o) => ({
        orderId: o.internalOrderId,
        ...bulkNoteRow('already-read', copy),
      })),
    ];
    mutation.mutate(
      split.candidates.map((o) => o.internalOrderId),
      {
        onSuccess: (data) => {
          setSkipped(skippedRows);
          setResult(data);
          onComplete?.();
        },
      },
    );
  }

  if (result !== null) {
    const rows: BulkResultRow[] = [
      ...result.results.map((row) => ({
        orderId: row.orderId,
        ...bulkNoteRow(row.outcome, copy),
        detail: row.reason ?? null,
      })),
      ...skipped,
    ];
    const skippedTotal = skipped.length + result.alreadyRead + result.noNote;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bulk-dispatch" data-testid="orders-bulk-read-dialog">
          <DialogTitle>{COPY.resultTitle}</DialogTitle>
          <DialogDescription data-testid="orders-bulk-read-summary">
            <strong>{plural(result.marked, COPY.markedCount)}</strong>
            {skippedTotal > 0 ? ` · ${plural(skippedTotal, COPY.skippedCount)}` : ''}
            {result.failed + result.notFound > 0
              ? ` · ${plural(result.failed + result.notFound, COPY.failedCount)}`
              : ''}
          </DialogDescription>
          <BulkResultRows rows={rows} testId="orders-bulk-read-results" />
          <DialogFooter>
            <Button
              tone="primary"
              data-testid="orders-bulk-read-close"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {COPY.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-hold-dialog" data-testid="orders-bulk-read-dialog">
        <DialogTitle>{plural(orders.length, COPY.title)}</DialogTitle>
        <DialogDescription>{COPY.description}</DialogDescription>
        {mutation.isError ? (
          <Alert tone="error" title={COPY.requestError} data-testid="orders-bulk-read-error">
            {readServerReason(mutation.error, COPY.requestError)}
          </Alert>
        ) : null}
        {split.candidates.length === 0 ? (
          <Alert tone="info" data-testid="orders-bulk-read-nothing">
            {COPY.nothingToDo}
          </Alert>
        ) : (
          <p data-testid="orders-bulk-read-plan">
            {skipCount > 0
              ? plural(split.candidates.length, COPY.summaryWithSkips, { skipped: skipCount })
              : plural(split.candidates.length, COPY.summary)}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            tone="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {COPY.cancel}
          </Button>
          <Button
            tone="primary"
            disabled={split.candidates.length === 0 || mutation.isPending}
            data-testid="orders-bulk-read-submit"
            onClick={run}
          >
            {mutation.isPending ? COPY.submitting : COPY.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
