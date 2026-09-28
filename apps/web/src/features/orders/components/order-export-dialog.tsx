/**
 * Order Export Dialog (#3534/#3535, D35, mockup M5)
 *
 * `data-mk-state` values follow the mockup's own vocabulary so the E2E
 * baselines (#3536) can drive the live app into the same named states as
 * the committed mockup file: `default`, `selected`, `preparing`, `ready`,
 * `large`, `error`. `background` and `viewer` are Jobs & Logs / role states
 * this component does not itself render.
 *
 * The date range defaults to `placedAt` (D35) — the dialog's own date
 * inputs write `placedFrom`/`placedTo`, independent of the list's own
 * `createdFrom`/`createdTo` filter chips.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '../../../shared/ui/dialog';
import { Select } from '../../../shared/ui/select';
import {
  ORDER_EXPORT_BACKGROUND_THRESHOLD,
  type CreateOrderExportRequest,
  type OrderExportFormatValue,
  type OrderExportScopeValue,
  type OrderFilters,
  type OrderRecord,
} from '../api/orders.types';
import { OrderColumnPresetManager } from './order-column-preset-manager';
import {
  useDownloadExportMutation,
  useOrderExportRunQuery,
  useRequestExportMutation,
} from '../hooks/use-order-export';

export interface OrderExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current /orders filters (the "current view"). */
  filters: OrderFilters;
  /** `null` while still counting — rendered as "Counting…", never 0. */
  filteredCount: number | null;
  /** The row selection, if any — offers the `selected` scope when non-empty. */
  selectedOrders: readonly OrderRecord[];
}

export function OrderExportDialog({
  open,
  onOpenChange,
  filters,
  filteredCount,
  selectedOrders,
}: OrderExportDialogProps): ReactElement {
  const [format, setFormat] = useState<OrderExportFormatValue>('csv');
  const [scope, setScope] = useState<OrderExportScopeValue>('filtered');
  const [columns, setColumns] = useState<string[]>([]);
  const [placedFrom, setPlacedFrom] = useState('');
  const [placedTo, setPlacedTo] = useState('');
  const [runId, setRunId] = useState<string | null>(null);

  const requestExport = useRequestExportMutation();
  const runQuery = useOrderExportRunQuery(runId);
  const download = useDownloadExportMutation();

  const run = runQuery.data;
  const dialogStage: 'form' | 'preparing' | 'ready' | 'error' =
    runId === null ? 'form' : run?.status === 'ready' ? 'ready' : run?.status === 'failed' ? 'error' : 'preparing';

  const effectiveScope: OrderExportScopeValue = selectedOrders.length > 0 ? scope : 'filtered';
  const candidateCount = effectiveScope === 'selected' ? selectedOrders.length : filteredCount;
  const isLarge = candidateCount !== null && candidateCount > ORDER_EXPORT_BACKGROUND_THRESHOLD;

  function reset(): void {
    setRunId(null);
  }

  function handleClose(): void {
    reset();
    onOpenChange(false);
  }

  function handleSubmit(): void {
    const body: CreateOrderExportRequest = {
      ...filters,
      format,
      scope: effectiveScope,
      selectedOrderIds:
        effectiveScope === 'selected' ? selectedOrders.map((o) => o.internalOrderId) : undefined,
      columns: columns.length > 0 ? columns : undefined,
      placedFrom: placedFrom ? new Date(placedFrom).toISOString() : undefined,
      placedTo: placedTo ? new Date(placedTo).toISOString() : undefined,
    };
    requestExport.mutate(body, {
      onSuccess: (run) => { setRunId(run.id); },
    });
  }

  const mkState = dialogStage === 'form' ? (isLarge ? 'large' : effectiveScope === 'selected' ? 'selected' : 'default') : dialogStage;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); else onOpenChange(true); }}>
      <DialogContent
        className="dialog__content--wide export-dialog"
        data-mk-state={mkState}
        data-testid="order-export-dialog"
      >
        {dialogStage === 'form' ? (
          <>
            <DialogTitle>Export orders</DialogTitle>
            <DialogDescription>
              Download orders as a spreadsheet file. Nothing in OpenLinker or on your channels
              changes.
            </DialogDescription>

            <div className="dialog__body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
              {selectedOrders.length > 0 ? (
                <label className="ack-row ack-row--inline">
                  <input
                    type="radio"
                    checked={scope === 'selected'}
                    onChange={() => { setScope('selected'); }}
                  />
                  <span>Selected rows only ({selectedOrders.length})</span>
                </label>
              ) : null}
              <label className="ack-row ack-row--inline">
                <input
                  type="radio"
                  checked={effectiveScope === 'filtered'}
                  onChange={() => { setScope('filtered'); }}
                />
                <span>
                  Current view (
                  {filteredCount === null ? 'Counting…' : `${filteredCount} orders`})
                </span>
              </label>

              <label className="orders-toolbar__field">
                <span className="orders-toolbar__label">Format</span>
                <Select
                  aria-label="Export format"
                  value={format}
                  onChange={(e) => { setFormat(e.target.value as OrderExportFormatValue); }}
                >
                  <option value="csv">CSV</option>
                  <option value="xlsx">XLSX</option>
                </Select>
              </label>

              <OrderColumnPresetManager columns={columns} onColumnsChange={setColumns} />

              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <label className="orders-toolbar__field">
                  <span className="orders-toolbar__label">Placed from</span>
                  <input
                    type="date"
                    className="control"
                    value={placedFrom}
                    onChange={(e) => { setPlacedFrom(e.target.value); }}
                  />
                </label>
                <label className="orders-toolbar__field">
                  <span className="orders-toolbar__label">Placed to</span>
                  <input
                    type="date"
                    className="control"
                    value={placedTo}
                    onChange={(e) => { setPlacedTo(e.target.value); }}
                  />
                </label>
              </div>

              {isLarge ? (
                <Alert tone="info">
                  This export covers more than {ORDER_EXPORT_BACKGROUND_THRESHOLD.toLocaleString()}{' '}
                  orders and will run in the background. The file will wait for you in Jobs &amp;
                  Logs once it is ready.
                </Alert>
              ) : null}

              {requestExport.isError ? (
                <Alert tone="error">
                  {requestExport.error.message || 'Could not start the export. Try again.'}
                </Alert>
              ) : null}
            </div>

            <DialogFooter>
              <Button tone="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                tone="primary"
                onClick={handleSubmit}
                disabled={requestExport.isPending || (effectiveScope === 'selected' && selectedOrders.length === 0)}
              >
                {requestExport.isPending ? 'Starting…' : 'Export'}
              </Button>
            </DialogFooter>
          </>
        ) : dialogStage === 'preparing' ? (
          <>
            <DialogTitle>Preparing export</DialogTitle>
            <DialogDescription>
              {isLarge
                ? 'You can close this window. The export keeps running, and the file appears in Jobs & Logs when it is ready.'
                : 'This usually takes a few seconds.'}
            </DialogDescription>
            <div className="export-progress" role="status" aria-live="polite">
              <p className="text-muted">Generating your file…</p>
            </div>
            <DialogFooter>
              <Button tone="secondary" onClick={handleClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : dialogStage === 'ready' && run ? (
          <>
            <DialogTitle>Export ready</DialogTitle>
            <DialogDescription>
              {run.rowCount ?? 0} orders from the {effectiveScope === 'selected' ? 'selection' : 'current view'}.
            </DialogDescription>
            <dl className="key-value-list">
              <dt className="key-value-list__label">Rows</dt>
              <dd className="key-value-list__value key-value-list__value--mono mono-text">
                {run.rowCount}
              </dd>
              <dt className="key-value-list__label">Personal data</dt>
              <dd className="key-value-list__value">{run.containsPii ? 'Included' : 'Not included'}</dd>
              <dt className="key-value-list__label">Available until</dt>
              <dd className="key-value-list__value key-value-list__value--mono mono-text">
                {new Date(run.expiresAt).toLocaleString()}
              </dd>
            </dl>
            <p className="text-muted">
              You can download it again from <Link to="/jobs-logs">Jobs &amp; Logs</Link> until then.
            </p>
            <DialogFooter>
              <Button tone="secondary" onClick={handleClose}>
                Close
              </Button>
              <Button
                tone="primary"
                onClick={() => { download.mutate({ runId: run.id, format: run.format }); }}
                disabled={download.isPending}
              >
                Download file
              </Button>
            </DialogFooter>
          </>
        ) : dialogStage === 'error' && run ? (
          <>
            <DialogTitle>Export failed</DialogTitle>
            <div className="dialog__body">
              <Alert tone="error" title="The export could not be generated">
                {run.errorMessage ?? 'An unexpected error stopped the export. No file was created.'}
              </Alert>
              <p className="text-muted">
                The job and its error stay in <Link to="/jobs-logs">Jobs &amp; Logs</Link>.
              </p>
            </div>
            <DialogFooter>
              <Button tone="ghost" onClick={reset}>
                Change settings
              </Button>
              <Button tone="secondary" onClick={handleClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
