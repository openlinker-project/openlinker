/**
 * Stock correction dialog (#3567, mockup m6)
 *
 * An operator corrects ONE variant's stock. The change is written to the
 * product's master connection - never to a marketplace - and the marketplaces
 * follow once the master confirms, so the dialog says where it writes and what
 * each channel will publish afterwards (D26: from available to promise, then
 * each channel's own buffer and zero threshold).
 *
 * Four rules shape it:
 *  - One idempotency key per dialog open, kept across a `confirmation-required`
 *    retry, so a re-send of the same correction can never apply twice.
 *  - A target OpenLinker will not guess (D41) REPLACES the form with the named
 *    reason; there is nothing to fill in.
 *  - An in-doubt outcome has no retry: filling the form again would be a new
 *    correction and could double the change if the first one landed.
 *  - The master's own confirmation time is shown only when the master reported
 *    one; OpenLinker's clock is never a stand-in for it.
 *
 * @module apps/web/src/features/inventory/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '../../../shared/api/api-error';
import { interpolate, useFormat, useMessages, type Formatters } from '../../../shared/i18n';
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
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Textarea } from '../../../shared/ui/textarea';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { CorrectStockResult } from '../api/inventory-correction.types';
import { CorrectionReasonValues } from '../api/inventory-correction.types';
import { useCorrectStockMutation } from '../hooks/use-correct-stock-mutation';
import { useCorrectionTargetQuery } from '../hooks/use-correction-target-query';
import {
  computeCorrectionPreview,
  correctionDelta,
  isLargeChange,
  type ChannelPreview,
  type CorrectionPreview,
} from '../lib/stock-correction-preview';
import {
  createStockCorrectionSchema,
  inlineErrorText,
  isTargetRefusalCode,
  NOTE_MAX_LENGTH,
  readEntry,
  reasonLabel,
  STOCK_CORRECTION_DEFAULT_VALUES,
  targetRefusalCopy,
  toCorrectStockInput,
  type StockCorrectionCopy,
  type StockCorrectionFormValues,
} from './stock-correction-dialog.schema';
import type { CorrectionTargetRefusalReason } from '../api/inventory-correction.types';
import { presentRefusalText } from '../lib/stock-movement-presentation';
import { stockRowKey, type StockAdjustTarget } from '../lib/stock-row';
import { describeApiError } from '../../../shared/api/describe-api-error';

export interface StockCorrectionDialogProps {
  /** `null` closes the dialog; a value opens it for that variant. */
  target: StockAdjustTarget | null;
  onClose: () => void;
}

export function StockCorrectionDialog({ target, onClose }: StockCorrectionDialogProps): ReactElement {
  // The body owns the mutation, so it is the one that knows a save is in
  // flight; it reports that up so the shell can refuse to close mid-save.
  // A ref, not state: a close request must read the CURRENT save state, not the
  // value of the last render, or Esc after a Tab-cycle slips through mid-save.
  const lockedRef = useRef(false);
  const setLocked = useCallback((value: boolean): void => {
    lockedRef.current = value;
  }, []);
  const openerRef = useRef<HTMLElement | null>(null);
  if (target === null) {
    openerRef.current = null;
  } else if (openerRef.current === null && document.activeElement instanceof HTMLElement) {
    // Radix moves focus into the dialog only after the first commit, so the
    // opener is still the active element while the open renders.
    openerRef.current = document.activeElement;
  }
  const lastKeyRef = useRef<string | null>(null);
  if (target !== null) lastKeyRef.current = stockRowKey(target.variant);

  const refuseWhileSaving = (event: Event): void => {
    if (lockedRef.current) event.preventDefault();
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !lockedRef.current) onClose();
      }}
    >
      <DialogContent
        className="sc-dialog"
        onEscapeKeyDown={refuseWhileSaving}
        onPointerDownOutside={refuseWhileSaving}
        onInteractOutside={refuseWhileSaving}
        onCloseAutoFocus={(event) => {
          // No Trigger wraps the opener, so Radix has nowhere to return focus to.
          event.preventDefault();
          const key = lastKeyRef.current;
          const opener = openerRef.current;
          const byTestId =
            key === null ? null : document.querySelector<HTMLElement>(`[data-testid="stock-adjust-${key}"]`);
          const toggle =
            key === null ? null : document.querySelector<HTMLElement>(`[data-testid="stock-variant-toggle-${key}"]`);
          const next = byTestId ?? (opener?.isConnected ? opener : null) ?? toggle;
          next?.focus();
        }}
      >
        {target !== null ? (
          <DialogBody key={target.variant.id} target={target} onClose={onClose} onLockChange={setLocked} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
}

function variantLabel(
  copy: StockCorrectionCopy,
  target: StockAdjustTarget,
): { name: string; sku: string | null } {
  const attributes = target.variant.attributes ? Object.values(target.variant.attributes).join(' / ') : '';
  return { name: attributes.length > 0 ? attributes : (target.variant.sku ?? copy.variant), sku: target.variant.sku };
}

function DialogTitleFor({ target }: { target: StockAdjustTarget }): ReactElement {
  const copy = useMessages('inventory').stockCorrectionDialog;
  const { name, sku } = variantLabel(copy, target);
  return (
    <DialogTitle>
      {interpolate(copy.title, { name })}{' '}
      {sku && sku !== name ? <span className="text-muted mono-text" style={{ fontWeight: 400 }}>{sku}</span> : null}
    </DialogTitle>
  );
}

function errorCode(error: Error | null): string | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  if (typeof details === 'object' && details !== null && 'code' in details && typeof details.code === 'string') {
    return details.code;
  }
  return null;
}

interface ServerConfirmation {
  /** The delta the client sent; what the block is matched against. */
  sentDelta: number;
  requestedDelta: number;
  currentQuantity: number | null;
  absoluteThresholdUnits: number | null;
  relativeThreshold: number | null;
}

interface SentCorrection {
  /** The count the operator saw when they sent it. */
  before: number | null;
  mode: StockCorrectionFormValues['mode'];
  /** What they typed: the target quantity in set mode, the signed change in delta mode. */
  entry: number;
}

/** The master's count as the server read it, when the refusal carries one. */
function errorCurrentQuantity(error: Error | null): number | null {
  const details = error instanceof ApiError ? error.details : null;
  const record = typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {};
  return numberOrNull(record.currentQuantity);
}

function insufficientStockCopy(copy: StockCorrectionCopy, masterName: string, count: number | null): string {
  return count === null
    ? interpolate(copy.insufficientStockUnknown, { master: masterName })
    : interpolate(copy.insufficientStockKnown, { master: masterName, n: count });
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads the 409 body's own figures; the server's thresholds are the authority. */
function readServerConfirmation(error: unknown, fallbackDelta: number): ServerConfirmation {
  const details = error instanceof ApiError ? error.details : null;
  const record = typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {};
  return {
    sentDelta: fallbackDelta,
    requestedDelta: numberOrNull(record.requestedDelta) ?? fallbackDelta,
    currentQuantity: numberOrNull(record.currentQuantity),
    absoluteThresholdUnits: numberOrNull(record.absoluteThresholdUnits),
    relativeThreshold: numberOrNull(record.relativeThreshold),
  };
}

function DialogBody({
  target,
  onClose,
  onLockChange,
}: {
  target: StockAdjustTarget;
  onClose: () => void;
  onLockChange: (locked: boolean) => void;
}): ReactElement {
  const copy = useMessages('inventory').stockCorrectionDialog;
  const format = useFormat();
  const schema = useMemo(() => createStockCorrectionSchema(copy), [copy]);
  // One key for the dialog's lifetime: the body is keyed by variant, so a new
  // open is a new key and a retry inside one open is the same one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const targetQuery = useCorrectionTargetQuery(target.variant.id);
  const mutation = useCorrectStockMutation();
  const [ackedDelta, setAckedDelta] = useState<number | null>(null);
  const [serverConfirm, setServerConfirm] = useState<ServerConfirmation | null>(null);
  // Frozen when the request goes out: a refetch of the target after an in-doubt
  // result must not change what the result view says was attempted.
  const [sent, setSent] = useState<SentCorrection | null>(null);

  const form = useForm<StockCorrectionFormValues>({
    defaultValues: STOCK_CORRECTION_DEFAULT_VALUES,
    resolver: zodResolver(schema),
  });
  const values = form.watch();

  const correctionTarget = targetQuery.data ?? null;
  const ready = correctionTarget !== null && correctionTarget.kind === 'ready' ? correctionTarget : null;
  const current = ready?.currentQuantity ?? null;
  const masterName = ready?.connectionName ?? copy.theMaster;

  const entry = readEntry(values);
  // Advisory only: `current` is OpenLinker's mirror, which can lag the master,
  // and the server judges the removal against a fresh master read
  // (`insufficient-stock`). Blocking here would refuse removals the server
  // accepts (docs/lessons.md, #2240), so the form warns and lets it through.
  const removalTooLarge =
    values.mode === 'delta' && entry !== null && current !== null && entry < 0 && -entry > current;
  const removalWarning = removalTooLarge
    ? interpolate(copy.removalWarning, { n: current, master: masterName })
    : undefined;
  const entryValid = entry !== null && (values.mode === 'delta' ? entry !== 0 : entry >= 0);
  const delta = current !== null && entry !== null && entryValid ? correctionDelta(values.mode, entry, current) : null;
  const newQuantity = current !== null && delta !== null ? Math.max(0, current + delta) : null;
  const needsConfirmation =
    delta !== null && current !== null && (isLargeChange(delta, current) || serverConfirm?.sentDelta === delta);
  const acknowledged = delta !== null && ackedDelta === delta;

  const preview = useMemo(
    () =>
      newQuantity === null
        ? null
        : computeCorrectionPreview({ newMasterQuantity: newQuantity, currentQuantity: current, stock: target.stock }),
    [newQuantity, current, target.stock],
  );

  const code = errorCode(mutation.error);
  const serverRefusalCode = isTargetRefusalCode(code) ? code : null;
  const pending = mutation.isPending;
  useEffect(() => {
    onLockChange(pending);
    return () => onLockChange(false);
  }, [pending, onLockChange]);

  const submit = form.handleSubmit(async (formValues) => {
    const parsed = readEntry(formValues);
    if (parsed === null || ready === null || current === null) return;
    const sentDelta = correctionDelta(formValues.mode, parsed, current);
    setSent({ before: current, mode: formValues.mode, entry: parsed });
    try {
      await mutation.mutateAsync({
        productVariantId: target.variant.id,
        input: toCorrectStockInput(formValues, parsed, idempotencyKey, ackedDelta === sentDelta),
      });
    } catch (error) {
      if (errorCode(error instanceof Error ? error : null) === 'confirmation-required') {
        // The server's figures can differ from ours when the current stock
        // moved; same key, the operator just has to tick the box.
        setServerConfirm(readServerConfirmation((error as ApiError), sentDelta));
      }
    }
  });

  if (pending) {
    return (
      <div data-testid="stock-correction-applying">
        <DialogTitleFor target={target} />
        <DialogDescription>
          {interpolate(copy.transition, {
            from: current ?? '?',
            to: newQuantity ?? '?',
            reason: reasonLabel(copy, values.reason),
          })}
        </DialogDescription>
        <dl className="key-value-list">
          <dt className="key-value-list__label">{copy.writesTo}</dt>
          <dd className="key-value-list__value">{ready?.connectionName ?? copy.theMasterConnection}</dd>
        </dl>
        <DialogFooter>
          <Button tone="secondary" disabled>
            {copy.cancel}
          </Button>
          <Button disabled>
            <span className="button__spinner" aria-hidden="true"></span>
            {interpolate(copy.savingTo, { master: masterName })}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  if (mutation.data) {
    return (
      <ResultView
        result={mutation.data}
        target={target}
        reason={values.reason}
        sent={sent ?? { before: current, mode: values.mode, entry: entry ?? 0 }}
        onClose={onClose}
        previewFor={(quantity) =>
          computeCorrectionPreview({ newMasterQuantity: quantity, currentQuantity: current, stock: target.stock })
        }
      />
    );
  }

  if (targetQuery.isLoading) {
    return (
      <>
        <DialogTitleFor target={target} />
        <DialogDescription>{copy.checkingTarget}</DialogDescription>
      </>
    );
  }

  if (targetQuery.isError || correctionTarget === null) {
    return (
      <>
        <DialogTitleFor target={target} />
        <Alert
          tone="error"
          title={copy.targetError.title}
          data-testid="stock-correction-target-error"
        >
          {targetQuery.error
            ? describeApiError(targetQuery.error, 'inventory')
            : copy.targetError.fallback}
        </Alert>
        <DialogFooter>
          <DialogClose asChild>
            <Button tone="secondary">{copy.close}</Button>
          </DialogClose>
          <Button onClick={() => { void targetQuery.refetch(); }}>{copy.retry}</Button>
        </DialogFooter>
      </>
    );
  }

  if (correctionTarget.kind === 'refused' || serverRefusalCode !== null) {
    const reason = serverRefusalCode ?? correctionTarget.reason ?? 'no-inventory-master';
    return <TargetRefusedView target={target} reason={reason} onClose={onClose} />;
  }

  const submitDisabled = !entryValid || (needsConfirmation && !acknowledged);
  const inlineError =
    code === 'confirmation-required' || mutation.error === null
      ? null
      : code === 'insufficient-stock'
        ? insufficientStockCopy(copy, masterName, errorCurrentQuantity(mutation.error))
        : inlineErrorText(copy, code, masterName) ?? describeApiError(mutation.error, 'inventory');

  return (
    <div data-testid="stock-correction-dialog">
      <DialogTitleFor target={target} />
      <DialogDescription>
        {interpolate(copy.description, { master: ready?.connectionName ?? copy.theMaster })}
      </DialogDescription>

      <form onSubmit={(event) => { void submit(event); }} noValidate className="sc-form">
        {inlineError ? (
          <Alert tone="error" title={copy.saveError} data-testid="stock-correction-error">
            {inlineError}
          </Alert>
        ) : null}

        <div className="form-field">
          <span className="form-field__label" id="sc-mode-label">
            {copy.modeLabel}
          </span>
          <SegmentedControl
            aria-labelledby="sc-mode-label"
            value={values.mode}
            onChange={(mode) => form.setValue('mode', mode, { shouldValidate: form.formState.submitCount > 0 })}
            options={[
              { value: 'set', label: copy.modeSet, 'data-testid': 'stock-correction-mode-set' },
              { value: 'delta', label: copy.modeDelta, 'data-testid': 'stock-correction-mode-delta' },
            ]}
          />
        </div>

        {values.mode === 'set' ? (
          <FormField
            label={copy.newQuantity}
            name="quantity"
            error={form.formState.errors.quantity?.message}
            description={[interpolate(copy.currently, { n: current ?? '?', master: masterName }), heldSentence(copy, target)]
              .filter((part) => part !== '')
              .join(' ')}
          >
            <Input type="number" min={0} step={1} inputMode="numeric" data-testid="stock-correction-quantity" {...form.register('quantity')} />
          </FormField>
        ) : (
          <FormField
            label={copy.changeBy}
            name="delta"
            error={form.formState.errors.delta?.message}
            description={removalWarning ?? copy.deltaHint}
          >
            <Input type="text" inputMode="numeric" data-testid="stock-correction-delta" {...form.register('delta')} />
          </FormField>
        )}

        <p className="sc-diff" data-testid="stock-correction-diff">
          {current ?? '?'} → {newQuantity === null ? '…' : <ins>{newQuantity}</ins>}
        </p>

        {needsConfirmation ? (
          <Alert tone="warning" title={copy.largeChange.title} data-testid="stock-correction-large-change">
            {serverConfirm !== null && serverConfirm.sentDelta === delta
              ? serverLargeChangeSentence(copy, format, serverConfirm)
              : copy.largeChange.default}
            <label className="sc-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAckedDelta(event.target.checked ? delta : null)}
                data-testid="stock-correction-large-change-confirm"
              />{' '}
              {copy.largeChange.confirm}
            </label>
          </Alert>
        ) : null}

        <FormField label={copy.reason} name="reason">
          <Select data-testid="stock-correction-reason" {...form.register('reason')}>
            {CorrectionReasonValues.map((reason) => (
              <option key={reason} value={reason}>
                {reasonLabel(copy, reason)}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label={values.reason === 'other' ? copy.noteRequired : copy.noteOptional}
          name="note"
          error={form.formState.errors.note?.message}
          description={interpolate(copy.noteHint, { master: masterName })}
        >
          <Textarea rows={2} maxLength={NOTE_MAX_LENGTH} data-testid="stock-correction-note" {...form.register('note')} />
        </FormField>

        <dl className="key-value-list">
          <dt className="key-value-list__label">{copy.writesTo}</dt>
          <dd className="key-value-list__value" data-testid="stock-correction-target">
            {ready?.connectionName} <span className="text-muted">{copy.masterConnectionSuffix}</span>
          </dd>
        </dl>

        <PreviewSection
          preview={preview}
          masterName={masterName}
          stockKnown={target.stock !== null}
          hasChannels={(target.stock?.channels.length ?? 0) > 0}
        />

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={onClose} data-testid="stock-correction-cancel">
            {copy.cancel}
          </Button>
          <Button type="submit" disabled={submitDisabled} data-testid="stock-correction-submit">
            {copy.save}
          </Button>
        </DialogFooter>
      </form>
    </div>
  );
}

function serverLargeChangeSentence(
  copy: StockCorrectionCopy,
  format: Formatters,
  confirm: ServerConfirmation,
): string {
  const large = copy.largeChange;
  const change = `${confirm.requestedDelta > 0 ? '+' : ''}${format.number(confirm.requestedDelta)}`;
  const head =
    confirm.currentQuantity === null
      ? interpolate(large.change, { change })
      : interpolate(large.changeFrom, { change, current: confirm.currentQuantity });
  const limits: string[] = [];
  if (confirm.absoluteThresholdUnits !== null) {
    limits.push(interpolate(large.absolute, { n: confirm.absoluteThresholdUnits }));
  }
  if (confirm.relativeThreshold !== null) {
    limits.push(
      interpolate(large.relative, {
        percent: format.percent(Math.round(confirm.relativeThreshold * 100) / 100),
      }),
    );
  }
  const rule = limits.length > 0 ? interpolate(large.rule, { limits: format.list(limits, 'disjunction') }) : null;
  return [head, rule, large.check].filter((part): part is string => part !== null).join(' ');
}

function heldSentence(copy: StockCorrectionCopy, target: StockAdjustTarget): string {
  const held = target.stock?.heldCounted;
  if (held === null || held === undefined) return '';
  return held > 0 ? interpolate(copy.heldSentence, { n: held }) : '';
}

function channelHow(copy: StockCorrectionCopy, channel: ChannelPreview): string {
  const parts: string[] = [];
  parts.push(
    channel.stockSafetyBuffer > 0
      ? interpolate(copy.channelHow.buffer, { n: channel.stockSafetyBuffer })
      : copy.channelHow.asIs,
  );
  if (channel.stockZeroThreshold > 0) {
    parts.push(interpolate(copy.channelHow.zeroThreshold, { n: channel.stockZeroThreshold }));
  }
  return parts.join(' ');
}

function qty(copy: StockCorrectionCopy, value: number | null): ReactNode {
  return value === null ? copy.notKnown : value;
}

function PreviewSection({
  preview,
  masterName,
  stockKnown,
  hasChannels,
}: {
  preview: CorrectionPreview | null;
  masterName: string;
  stockKnown: boolean;
  hasChannels: boolean;
}): ReactElement {
  const copy = useMessages('inventory').stockCorrectionDialog;
  const preview_ = copy.preview;
  return (
    <>
      <p className="sc-section-head">{preview_.heading}</p>
      {preview === null ? (
        <p className="sc-footnote" data-testid="stock-correction-preview">
          {preview_.enterQuantity}
        </p>
      ) : !stockKnown ? (
        <p className="sc-footnote" data-testid="stock-correction-preview">
          {preview_.unavailable}
        </p>
      ) : (
        <ul className="sc-impact" data-testid="stock-correction-preview">
          <li className="sc-impact__row" data-testid="stock-correction-preview-master">
            <span className="sc-impact__what">
              {masterName}
              <span className="sc-impact__sub">{preview_.master}</span>
            </span>
            <span className="sc-impact__how">{preview_.masterHow}</span>
            <span className="sc-impact__qty">{preview.masterQuantity}</span>
          </li>
          <li className="sc-impact__row" data-testid="stock-correction-preview-atp">
            <span className="sc-impact__what">
              {preview_.toSell}
              <span className="sc-impact__sub">{preview_.toSellSub}</span>
            </span>
            <span className="sc-impact__how">
              {preview.heldCounted === null
                ? preview_.heldUnknown
                : interpolate(preview_.heldKnown, { n: preview.heldCounted })}
            </span>
            <span className="sc-impact__qty">{qty(copy, preview.availableToPromise)}</span>
          </li>
          {preview.channels.map((channel) => (
            <li
              key={channel.connectionId}
              className="sc-impact__row"
              data-testid={`stock-correction-preview-${channel.platformType}`}
            >
              <span className="sc-impact__what">
                {channel.connectionName}
                <span className="sc-impact__sub">{channel.platformType}</span>
              </span>
              <span className="sc-impact__how">{channelHow(copy, channel)}</span>
              <span className="sc-impact__qty">{qty(copy, channel.quantity)}</span>
            </li>
          ))}
        </ul>
      )}
      {hasChannels ? (
        <p className="sc-footnote">{preview_.catchUp}</p>
      ) : null}
    </>
  );
}

function TargetRefusedView({
  target,
  reason,
  onClose,
}: {
  target: StockAdjustTarget;
  reason: CorrectionTargetRefusalReason;
  onClose: () => void;
}): ReactElement {
  const dialogCopy = useMessages('inventory').stockCorrectionDialog;
  const copy = targetRefusalCopy(dialogCopy, reason);
  return (
    <div data-testid="stock-correction-target-refused">
      <DialogTitleFor target={target} />
      <Alert tone="error" title={copy.title} data-testid="stock-correction-target-refused-reason">
        {copy.body}
      </Alert>
      <DialogFooter>
        <Button tone="secondary" onClick={onClose} data-testid="stock-correction-close">
          {dialogCopy.close}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ResultView({
  result,
  target,
  reason,
  sent,
  onClose,
  previewFor,
}: {
  result: CorrectStockResult;
  target: StockAdjustTarget;
  reason: StockCorrectionFormValues['reason'];
  /** What the operator sent; refused and in-doubt results carry no count of their own. */
  sent: SentCorrection;
  onClose: () => void;
  previewFor: (quantity: number) => CorrectionPreview;
}): ReactElement {
  const copy = useMessages('inventory').stockCorrectionDialog;
  const master = result.master.connectionName;
  const before = result.quantityBefore ?? sent.before;
  // Set mode shows the operator's own target. The server's delta was worked out
  // against its own read of the master, which can differ from the count shown.
  const attemptedTo =
    sent.mode === 'set' ? sent.entry : sent.before === null ? null : sent.before + sent.entry;
  const attempt =
    attemptedTo === null
      ? interpolate(copy.attemptChange, { delta: formatSigned(sent.entry) })
      : `${sent.before ?? '?'} → ${attemptedTo}`;
  const { name, sku } = variantLabel(copy, target);
  const reasonText = reasonLabel(copy, reason);

  if (result.status === 'applied') {
    const after = result.quantityAfter ?? attemptedTo;
    const channels = after === null ? [] : previewFor(after).channels;
    const appliedAt = result.adjustmentOutcome?.appliedAt ?? null;
    return (
      <div data-testid="stock-correction-applied">
        <DialogTitle>
          {copy.applied.title}{' '}
          <StatusBadge tone="success" data-testid="stock-correction-confirmed">
            {copy.applied.confirmed}
          </StatusBadge>
        </DialogTitle>
        <DialogDescription>
          {interpolate(copy.applied.description, { master, name })}
          {result.deduplicated ? ` ${copy.applied.deduplicated}` : ''}
        </DialogDescription>
        <dl className="key-value-list">
          <dt className="key-value-list__label">{copy.applied.variant}</dt>
          <dd className="key-value-list__value mono-text">{sku ?? name} · {name}</dd>
          <dt className="key-value-list__label">{copy.applied.quantity}</dt>
          <dd className="key-value-list__value">
            {before ?? '?'} → <ins>{after ?? '?'}</ins>
          </dd>
          <dt className="key-value-list__label">{copy.applied.reason}</dt>
          <dd className="key-value-list__value">{reasonText}</dd>
          <dt className="key-value-list__label">{copy.applied.master}</dt>
          <dd className="key-value-list__value">{master}</dd>
          {appliedAt ? (
            <>
              <dt className="key-value-list__label">{copy.applied.confirmedAt}</dt>
              <dd className="key-value-list__value" data-testid="stock-correction-applied-at">
                <TimeDisplay iso={appliedAt} />
              </dd>
            </>
          ) : null}
          {channels.length > 0 ? (
            <>
              <dt className="key-value-list__label">{copy.applied.channels}</dt>
              <dd className="key-value-list__value" data-testid="stock-correction-applied-channels">
                {interpolate(copy.applied.withinMinute, {
                  channels: channels
                    .map((channel) =>
                      interpolate(copy.applied.channelPublishes, {
                        channel: channel.connectionName,
                        n: channel.quantity ?? copy.applied.unknownAmount,
                      }),
                    )
                    .join(', '),
                })}
              </dd>
            </>
          ) : null}
        </dl>
        <DialogFooter>
          <Button onClick={onClose} data-testid="stock-correction-done">
            {copy.applied.done}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  if (result.status === 'refused') {
    return (
      <div data-testid="stock-correction-refused">
        <DialogTitleFor target={target} />
        <p className="sc-attempt">
          {interpolate(copy.refused.attempted, { attempt, reason: reasonText })}{' '}
          <StatusBadge tone="error">{copy.refused.notApplied}</StatusBadge>
        </p>
        <Alert
          tone="error"
          title={interpolate(copy.refused.title, { master })}
          data-testid="stock-correction-refused-reason"
        >
          {presentRefusalText(result.refusal?.reason ?? null, result.refusal?.detail ?? null, master) ??
            copy.refused.noReason}
        </Alert>
        <DialogFooter>
          <Button tone="secondary" onClick={onClose} data-testid="stock-correction-close">
            {copy.close}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div data-testid="stock-correction-in-doubt">
      <DialogTitleFor target={target} />
      <p className="sc-attempt">
        {interpolate(copy.inDoubt.sent, { attempt, reason: reasonText })}
      </p>
      <Alert tone="warning" title={interpolate(copy.inDoubt.title, { master })}>
        {copy.inDoubt.body}
      </Alert>
      <p className="form-field__description" style={{ marginTop: 'var(--space-2)' }}>
        {interpolate(copy.inDoubt.hint, { master })}
      </p>
      <DialogFooter>
        <Button tone="secondary" onClick={onClose} data-testid="stock-correction-close">
          {copy.close}
        </Button>
      </DialogFooter>
    </div>
  );
}
