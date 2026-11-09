/**
 * Order Export Dialog (#3534/#3535, D35, mockup M5, #3507 PR 8)
 *
 * `data-mk-state` values follow the mockup's own vocabulary so the E2E
 * baselines (#3536) can drive the live app into the same named states as
 * the committed mockup file: `default`, `selected`, `preparing`, `ready`,
 * `large`, `error`. `background` is the page-level toast
 * (`useOrderExportBackgroundToast`) and `viewer` a role state; this component
 * renders neither.
 *
 * Three scopes, as in M5: the current view (the list's own filters, verbatim),
 * the ticked rows, or a placed-date range over every source (D35: `placedAt`,
 * independent of the list's `createdFrom`/`createdTo` chips).
 *
 * What the mockup draws and this does NOT, because the backend has no field
 * for it yet (#3507 PR 8 "deferred"): a separator choice (CSV is always
 * semicolon, shown as a fact), rows per line item, a preview, the file size,
 * real progress and cancelling a run. A control for any of those would
 * promise something the export cannot do.
 *
 * @module apps/web/src/features/orders/components
 */
import { useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import {
  ORDER_EXPORT_BACKGROUND_THRESHOLD,
  ORDER_EXPORT_COLUMN_IDS,
  ORDER_EXPORT_COLUMN_LABELS,
  ORDER_EXPORT_DEFAULT_COLUMNS,
  ORDER_EXPORT_PII_COLUMNS,
  type CreateOrderExportRequest,
  type OrderExportColumnIdValue,
  type OrderExportFormatValue,
  type OrderExportRun,
  type OrderFilters,
  type OrderRecord,
} from '../api/orders.types';
import {
  ORDER_EXPORT_JOBS_PATH,
  useDownloadExportMutation,
  useOrderExportRunQuery,
  useRequestExportMutation,
} from '../hooks/use-order-export';
import {
  useCreateColumnPresetMutation,
  useOrderColumnPresetsQuery,
} from '../hooks/use-order-column-presets';
import {
  ORDER_EXPORT_BUILT_IN_PRESETS,
  ORDER_EXPORT_COLUMN_GROUPS,
  isOrderExportPiiColumn,
  narrowToExportColumns,
  orderExportFileName,
} from '../lib/order-export-columns';
import { interpolate, renderRich, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { serverErrorText } from '../lib/server-error-text';

type ExportScope = 'view' | 'selected' | 'range';

export interface OrderExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current /orders filters (the "current view"). */
  filters: OrderFilters;
  /** `null` while still counting — rendered as "Counting…", never 0. */
  filteredCount: number | null;
  /** The row selection. "Selected orders" is always offered, and disabled while this is empty. */
  selectedOrders: readonly OrderRecord[];
  /** A human description of the active filters, shown under "Current view". */
  scopeDescription?: string;
  /** The scope the dialog opens on. `'selected'` falls back to the view when nothing is ticked. */
  initialScope?: 'view' | 'selected';
  /**
   * Called with the run id when the operator closes the dialog while the run
   * is still preparing — hand it to `useOrderExportBackgroundToast().track`
   * so the outcome is announced after the dialog is gone.
   */
  onContinueInBackground?: (runId: string) => void;
}

/** What was sent, kept so "Try again" re-sends exactly it and "ready" can describe it. */
interface SubmittedExport {
  request: CreateOrderExportRequest;
  scope: ExportScope;
  expectedRows: number | null;
  columnCount: number;
  presetLabel: string | null;
}

const ALL_COLUMN_COUNT = ORDER_EXPORT_COLUMN_IDS.length;

function hasPiiColumn(columns: readonly string[]): boolean {
  return columns.some(isOrderExportPiiColumn);
}

/** A `<input type="date">` value as the start / end of that LOCAL day, in ISO. */
function startOfDayIso(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00`).toISOString() : undefined;
}
function endOfDayIso(value: string): string | undefined {
  return value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined;
}

export function OrderExportDialog({
  open,
  onOpenChange,
  filters,
  filteredCount,
  selectedOrders,
  scopeDescription,
  initialScope = 'view',
  onContinueInBackground,
}: OrderExportDialogProps): ReactElement {
  const uid = useId();
  const copy = useMessages('orders').orderExport;
  const serverSaid = useMessages('orders').common.serverSaid;
  const fmt = useFormat();
  const plural = usePlural();
  const formatExportCount = (value: number): string => fmt.number(value);
  const [format, setFormat] = useState<OrderExportFormatValue>('csv');
  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [selection, setSelection] = useState<OrderExportColumnIdValue[]>([...ORDER_EXPORT_DEFAULT_COLUMNS]);
  const [includePii, setIncludePii] = useState(() => hasPiiColumn(ORDER_EXPORT_DEFAULT_COLUMNS));
  const [presetId, setPresetId] = useState<string>(ORDER_EXPORT_BUILT_IN_PRESETS[0].id);
  const [presetEdited, setPresetEdited] = useState(false);
  const [placedFrom, setPlacedFrom] = useState('');
  const [placedTo, setPlacedTo] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedExport | null>(null);

  const requestExport = useRequestExportMutation();
  const runQuery = useOrderExportRunQuery(runId);
  const download = useDownloadExportMutation();
  const presetsQuery = useOrderColumnPresetsQuery();
  const createPreset = useCreateColumnPresetMutation();

  // Each opening starts on the scope the caller asked for — the bulk bar's
  // "Export N" opens on the selection, the header button on the view. Adjusted
  // during render (React's "storing information from previous renders"), not
  // in an effect, so the first painted frame is already the right scope.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setScope(initialScope);
  }

  const hasSelection = selectedOrders.length > 0;
  const effectiveScope: ExportScope = scope === 'selected' && !hasSelection ? 'view' : scope;
  const candidateCount: number | null =
    effectiveScope === 'selected' ? selectedOrders.length : effectiveScope === 'view' ? filteredCount : null;
  const isLarge = candidateCount !== null && candidateCount > ORDER_EXPORT_BACKGROUND_THRESHOLD;

  const columns = useMemo(
    () => selection.filter((id) => includePii || !isOrderExportPiiColumn(id)),
    [selection, includePii],
  );
  const willContainPii = hasPiiColumn(columns);

  const savedPresets = useMemo(
    () =>
      (presetsQuery.data ?? [])
        .map((p) => ({ id: p.id, label: p.name, columns: narrowToExportColumns(p.columns) }))
        .filter((p) => p.columns.length > 0),
    [presetsQuery.data],
  );
  const presetOptions = [
    ...ORDER_EXPORT_BUILT_IN_PRESETS.map((p) => ({
      id: p.id,
      label:
        p.id === 'builtin:all'
          ? copy.presets[p.labelKey]
          : interpolate(copy.presetBuiltIn, { label: copy.presets[p.labelKey] }),
      plainLabel: copy.presets[p.labelKey],
      columns: p.columns,
    })),
    ...savedPresets.map((p) => ({ ...p, plainLabel: p.label })),
  ];
  const activePreset = presetOptions.find((p) => p.id === presetId) ?? null;

  const run: OrderExportRun | undefined = runQuery.data ?? requestExport.data;
  const stage: 'form' | 'preparing' | 'ready' | 'error' =
    runId === null ? 'form' : run?.status === 'ready' ? 'ready' : run?.status === 'failed' ? 'error' : 'preparing';
  const mkState =
    stage === 'form' ? (isLarge ? 'large' : effectiveScope === 'selected' ? 'selected' : 'default') : stage;

  function applyPreset(id: string): void {
    const preset = presetOptions.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setPresetEdited(false);
    setSelection([...preset.columns]);
    if (hasPiiColumn(preset.columns)) setIncludePii(true);
  }

  function toggleColumn(id: OrderExportColumnIdValue, checked: boolean): void {
    setSelection((current) => (checked ? [...current.filter((c) => c !== id), id] : current.filter((c) => c !== id)));
    setPresetEdited(true);
  }

  function togglePii(checked: boolean): void {
    setIncludePii(checked);
    // Turning it on with no buyer column ticked would change nothing visible.
    if (checked && !hasPiiColumn(selection)) {
      setSelection((current) => [...current, ...ORDER_EXPORT_PII_COLUMNS]);
    }
  }

  function savePreset(): void {
    const name = presetName.trim();
    if (!name) return;
    createPreset.mutate(
      { name, columns: [...columns] },
      {
        onSuccess: (preset) => {
          setPresetId(preset.id);
          setPresetEdited(false);
          setSavingPreset(false);
          setPresetName('');
        },
      },
    );
  }

  function closeSaveRow(): void {
    setSavingPreset(false);
    setPresetName('');
    createPreset.reset();
  }

  function buildRequest(): CreateOrderExportRequest {
    if (effectiveScope === 'selected') {
      return {
        ...filters,
        format,
        scope: 'selected',
        selectedOrderIds: selectedOrders.map((o) => o.internalOrderId),
        columns: [...columns],
      };
    }
    if (effectiveScope === 'range') {
      return {
        format,
        scope: 'filtered',
        columns: [...columns],
        placedFrom: startOfDayIso(placedFrom),
        placedTo: endOfDayIso(placedTo),
      };
    }
    return { ...filters, format, scope: 'filtered', columns: [...columns] };
  }

  function send(next: SubmittedExport): void {
    setSubmitted(next);
    requestExport.mutate(next.request, {
      onSuccess: (created) => { setRunId(created.id); },
    });
  }

  function handleSubmit(): void {
    send({
      request: buildRequest(),
      scope: effectiveScope,
      expectedRows: candidateCount,
      columnCount: columns.length,
      presetLabel: activePreset && !presetEdited ? activePreset.plainLabel : null,
    });
  }

  function handleTryAgain(): void {
    // The failed run stays on screen (with "Starting…") until the new one
    // exists, rather than flashing the settings form in between.
    if (!submitted) return;
    send(submitted);
  }

  function backToSettings(): void {
    setRunId(null);
    requestExport.reset();
    download.reset();
  }

  function handleClose(): void {
    if (stage === 'preparing' && runId !== null) onContinueInBackground?.(runId);
    backToSettings();
    closeSaveRow();
    onOpenChange(false);
  }

  const countText = (value: number | null): string =>
    value === null ? copy.counting : formatExportCount(value);

  const summaryRows =
    effectiveScope === 'range'
      ? copy.summaryRowsUnknown
      : candidateCount === null
        ? copy.counting
        : plural(candidateCount, copy.summaryRows);
  const submitLabel = requestExport.isPending
    ? copy.submitting
    : isLarge
      ? copy.submitBackground
      : candidateCount === null
        ? copy.submitUnknown
        : plural(candidateCount, copy.submitCount);

  const fileName = run ? orderExportFileName(run, run.format) : null;
  const kvColumnsValue = (n: number, preset: string | null): string =>
    preset ? interpolate(copy.kvColumnsValue, { n: formatExportCount(n), preset }) : formatExportCount(n);

  let body: ReactNode;
  if (stage === 'form') {
    body = (
      <>
        <div className="dialog__header">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </div>
        <div className="export-dialog__body">
          <div className="export-dialog__top">
            <div className="dialog-section">
              <h3 className="dialog-section__head">{copy.ordersHead}</h3>
              <div className="marketplace-picker export-scope" role="radiogroup" aria-label={copy.ordersGroupLabel}>
                <ScopeOption
                  name={`${uid}-scope`}
                  value="view"
                  picked={effectiveScope === 'view'}
                  title={copy.scopeView}
                  hint={scopeDescription || copy.scopeViewHintFallback}
                  count={countText(filteredCount)}
                  onPick={setScope}
                />
                <ScopeOption
                  name={`${uid}-scope`}
                  value="selected"
                  picked={effectiveScope === 'selected'}
                  disabled={!hasSelection}
                  title={copy.scopeSelected}
                  hint={
                    hasSelection
                      ? plural(selectedOrders.length, copy.scopeSelectedHint)
                      : copy.scopeSelectedHintNone
                  }
                  count={formatExportCount(selectedOrders.length)}
                  onPick={setScope}
                />
                <ScopeOption
                  name={`${uid}-scope`}
                  value="range"
                  picked={effectiveScope === 'range'}
                  title={copy.scopeRange}
                  hint={copy.scopeRangeHint}
                  count=""
                  onPick={setScope}
                />
              </div>
              {effectiveScope === 'range' ? (
                <div className="export-scope__dates">
                  <FormField label={copy.placedFrom} name="export-placed-from">
                    <Input type="date" value={placedFrom} max={placedTo || undefined} onChange={(e) => { setPlacedFrom(e.target.value); }} />
                  </FormField>
                  <FormField label={copy.placedTo} name="export-placed-to">
                    <Input type="date" value={placedTo} min={placedFrom || undefined} onChange={(e) => { setPlacedTo(e.target.value); }} />
                  </FormField>
                </div>
              ) : null}
            </div>

            <div className="dialog-section">
              <h3 className="dialog-section__head">{copy.fileHead}</h3>
              <div className="export-dialog__stack">
                <div className="form-field">
                  <span className="form-field__label" id={`${uid}-format`}>{copy.format}</span>
                  <SegmentedControl<OrderExportFormatValue>
                    aria-labelledby={`${uid}-format`}
                    value={format}
                    onChange={setFormat}
                    options={[
                      { value: 'csv', label: copy.formatCsv },
                      { value: 'xlsx', label: copy.formatXlsx },
                    ]}
                  />
                </div>
                {format === 'csv' ? (
                  <div className="form-field">
                    <span className="form-field__label">{copy.separator}</span>
                    <p className="export-dialog__fact">{copy.separatorValue}</p>
                    <p className="form-field__description">{copy.separatorHint}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="dialog-section">
            <h3 className="dialog-section__head">
              {copy.columnsHead}
              <span className="mono tabular">{interpolate(copy.columnsCount, { n: columns.length, total: ALL_COLUMN_COUNT })}</span>
            </h3>
            <div className="export-presets">
              <div className="export-presets__select">
                <FormField label={copy.preset} name="export-preset">
                  <Select value={presetId} onChange={(e) => { applyPreset(e.target.value); }}>
                    {presetOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id === presetId && presetEdited
                          ? interpolate(copy.presetEdited, { label: p.plainLabel })
                          : p.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              {savingPreset ? null : (
                <Button tone="ghost" className="button--sm" onClick={() => { setSavingPreset(true); }}>
                  {copy.saveAsPreset}
                </Button>
              )}
              {savingPreset ? (
                <div className="export-presets__save">
                  <Input
                    aria-label={copy.presetName}
                    placeholder={copy.presetName}
                    value={presetName}
                    autoFocus
                    onChange={(e) => { setPresetName(e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); savePreset(); }
                    }}
                  />
                  <Button
                    tone="secondary"
                    className="button--sm"
                    onClick={savePreset}
                    disabled={!presetName.trim() || columns.length === 0 || createPreset.isPending}
                  >
                    {copy.savePreset}
                  </Button>
                  <Button tone="ghost" className="button--sm" onClick={closeSaveRow}>
                    {copy.cancel}
                  </Button>
                  {createPreset.isError ? <p className="form-field__error export-presets__note">{copy.savePresetError}</p> : null}
                </div>
              ) : null}
              {presetsQuery.isError ? (
                <p className="form-field__description export-presets__note">{copy.presetsLoadError}</p>
              ) : null}
            </div>

            <div className="export-columns">
              {ORDER_EXPORT_COLUMN_GROUPS.map((group) => {
                const on = group.columns.filter((id) => columns.includes(id)).length;
                return (
                  <fieldset key={group.id}>
                    <legend>
                      <span>{copy.columnGroups[group.id]}</span>
                      <span className="mono tabular">
                        {interpolate(copy.groupCount, { on, total: group.columns.length })}
                      </span>
                    </legend>
                    {group.columns.map((id) => {
                      const locked = !includePii && isOrderExportPiiColumn(id);
                      return (
                        <label key={id} className={locked ? 'export-check export-check--disabled' : 'export-check'}>
                          <input
                            type="checkbox"
                            checked={columns.includes(id)}
                            disabled={locked}
                            onChange={(e) => { toggleColumn(id, e.target.checked); }}
                          />
                          {ORDER_EXPORT_COLUMN_LABELS[id]}
                        </label>
                      );
                    })}
                    {group.id === 'buyer' && !includePii ? (
                      <p className="export-columns__hint">{copy.piiDisabledHint}</p>
                    ) : null}
                  </fieldset>
                );
              })}
            </div>
            {columns.length === 0 ? <p className="form-field__error export-columns__empty">{copy.noColumns}</p> : null}
          </div>

          <div className="dialog-section">
            <h3 className="dialog-section__head">{copy.piiHead}</h3>
            <label className="export-pii">
              <input type="checkbox" checked={includePii} onChange={(e) => { togglePii(e.target.checked); }} />
              <span className="export-pii__text">
                {copy.piiToggle}
                <span className="form-field__description">{copy.piiToggleHint}</span>
              </span>
            </label>
            {willContainPii ? (
              <Alert tone="warning" title={copy.piiWarningTitle} data-testid="order-export-pii-warning">
                {copy.piiWarningBody}
              </Alert>
            ) : null}
          </div>

          {isLarge && candidateCount !== null ? (
            <Alert tone="info" className="export-dialog__notice" title={copy.largeTitle}>
              {interpolate(copy.largeBody, {
                count: formatExportCount(candidateCount),
                limit: formatExportCount(ORDER_EXPORT_BACKGROUND_THRESHOLD),
              })}
            </Alert>
          ) : null}
          {requestExport.isError ? (
            <Alert tone="error" className="export-dialog__notice">
              {serverErrorText(serverSaid, requestExport.error.message, copy.startFailed)}
            </Alert>
          ) : null}

          <DialogFooter className="dialog__footer--split">
            <span className="text-muted mono tabular export-dialog__summary" data-testid="order-export-summary">
              {interpolate(copy.summary, {
                rows: summaryRows,
                columns: plural(columns.length, copy.summaryColumns),
                format: format === 'xlsx' ? copy.summaryFormatXlsx : copy.summaryFormatCsv,
              })}
            </span>
            <div className="dialog__footer-group">
              <Button tone="secondary" onClick={handleClose}>
                {copy.cancel}
              </Button>
              <Button
                tone="primary"
                onClick={handleSubmit}
                disabled={requestExport.isPending || columns.length === 0}
              >
                {submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </>
    );
  } else if (stage === 'preparing') {
    body = (
      <>
        <div className="dialog__header">
          <DialogTitle>{copy.preparingTitle}</DialogTitle>
          <DialogDescription className="mono-text">{fileName}</DialogDescription>
        </div>
        <div className="export-progress" role="status" aria-live="polite">
          <div className="publish-progress__track export-progress__track" role="progressbar" aria-label={copy.preparingProgressLabel}>
            <div className="publish-progress__fill export-progress__fill" />
          </div>
          <div className="export-progress__row">
            <span className="mono tabular">
              {submitted?.expectedRows != null ? plural(submitted.expectedRows, copy.preparingRows) : ''}
            </span>
            <span className="text-muted">{copy.preparingStatus}</span>
          </div>
        </div>
        <div className="dialog__body">
          <p>{copy.preparingClose}</p>
        </div>
        <DialogFooter>
          <Button tone="secondary" onClick={handleClose}>
            {copy.close}
          </Button>
        </DialogFooter>
      </>
    );
  } else if (stage === 'ready' && run) {
    const rows = run.rowCount ?? 0;
    body = (
      <>
        <div className="dialog__header">
          <div className="export-heading-row">
            <DialogTitle>{copy.readyTitle}</DialogTitle>
            <StatusBadge tone="success" compact withDot>{copy.readyBadge}</StatusBadge>
          </div>
          <DialogDescription>
            {plural(rows, copy.readyDescription[submitted?.scope ?? 'view'])}
          </DialogDescription>
        </div>
        <KeyValueList
          items={[
            { id: 'file', label: copy.kvFile, mono: true, value: fileName },
            { id: 'rows', label: copy.kvRows, mono: true, value: formatExportCount(rows) },
            {
              id: 'columns',
              label: copy.kvColumns,
              value: kvColumnsValue(submitted?.columnCount ?? columns.length, submitted?.presetLabel ?? null),
            },
            {
              id: 'pii',
              label: copy.kvPersonalData,
              value: run.containsPii ? copy.piiIncluded : copy.piiNotIncluded,
            },
            {
              id: 'until',
              label: copy.kvAvailableUntil,
              mono: true,
              value: <TimeDisplay iso={run.expiresAt} format="datetime" />,
            },
          ]}
        />
        <div className="dialog__body">
          <p className="text-muted">
            {renderRich(copy.readyAgain, {
              link: (text) => <Link to={ORDER_EXPORT_JOBS_PATH}>{text}</Link>,
            })}
          </p>
          {download.isError ? <Alert tone="error">{copy.downloadFailed}</Alert> : null}
        </div>
        <DialogFooter>
          <Button tone="secondary" onClick={handleClose}>
            {copy.close}
          </Button>
          <Button
            tone="primary"
            onClick={() => { download.mutate({ run }); }}
            disabled={download.isPending}
          >
            {download.isPending ? copy.downloading : copy.download}
          </Button>
        </DialogFooter>
      </>
    );
  } else if (stage === 'error' && run) {
    body = (
      <>
        <div className="dialog__header">
          <DialogTitle>{copy.errorTitle}</DialogTitle>
          <DialogDescription className="mono-text">{fileName}</DialogDescription>
        </div>
        <div className="dialog__body">
          <Alert tone="error" title={copy.errorAlertTitle}>
            {run.errorMessage ?? copy.errorFallback}
          </Alert>
          <p className="text-muted">
            {renderRich(copy.errorJob, {
              link: (text) => <Link to={ORDER_EXPORT_JOBS_PATH}>{text}</Link>,
            })}
          </p>
          {requestExport.isError ? (
            <Alert tone="error">{serverErrorText(serverSaid, requestExport.error.message, copy.startFailed)}</Alert>
          ) : null}
        </div>
        <DialogFooter className="dialog__footer--split">
          <Button tone="ghost" onClick={backToSettings}>
            {copy.changeSettings}
          </Button>
          <div className="dialog__footer-group">
            <Button tone="secondary" onClick={handleClose}>
              {copy.close}
            </Button>
            <Button tone="primary" onClick={handleTryAgain} disabled={requestExport.isPending}>
              {requestExport.isPending ? copy.submitting : copy.tryAgain}
            </Button>
          </div>
        </DialogFooter>
      </>
    );
  } else {
    body = null;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); else onOpenChange(true); }}>
      <DialogContent
        className={stage === 'form' ? 'dialog__content--wide export-dialog' : 'export-small-dialog'}
        data-mk-state={mkState}
        data-testid="order-export-dialog"
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}

interface ScopeOptionProps {
  name: string;
  value: ExportScope;
  picked: boolean;
  disabled?: boolean;
  title: string;
  hint: string;
  count: string;
  onPick: (value: ExportScope) => void;
}

function ScopeOption({ name, value, picked, disabled = false, title, hint, count, onPick }: ScopeOptionProps): ReactElement {
  const id = useId();
  const classes = [
    'marketplace-picker__option',
    picked ? 'marketplace-picker__option--picked' : '',
    disabled ? 'export-scope__option--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <label className={classes}>
      <span className="export-scope__lead">
        <input
          type="radio"
          name={name}
          value={value}
          checked={picked}
          disabled={disabled}
          aria-labelledby={`${id}-name`}
          aria-describedby={`${id}-hint`}
          onChange={() => { onPick(value); }}
        />
        <span className="marketplace-picker__meta">
          <span className="marketplace-picker__name" id={`${id}-name`}>{title}</span>
          <span className="text-muted export-scope__hint" id={`${id}-hint`}>{hint}</span>
        </span>
      </span>
      <span className="mono tabular export-scope__count">{count}</span>
    </label>
  );
}
