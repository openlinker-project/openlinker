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
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '../../../shared/api/api-error';
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
  INLINE_ERROR_COPY,
  isTargetRefusalCode,
  NOTE_MAX_LENGTH,
  readEntry,
  REASON_LABEL,
  STOCK_CORRECTION_DEFAULT_VALUES,
  stockCorrectionSchema,
  TARGET_REFUSAL_COPY,
  toCorrectStockInput,
  type StockCorrectionFormValues,
} from './stock-correction-dialog.schema';
import type { StockAdjustTarget } from './stock-panel';

export interface StockCorrectionDialogProps {
  /** `null` closes the dialog; a value opens it for that variant. */
  target: StockAdjustTarget | null;
  onClose: () => void;
}

export function StockCorrectionDialog({ target, onClose }: StockCorrectionDialogProps): ReactElement {
  // The body owns the mutation, so it is the one that knows a save is in
  // flight; it reports that up so the shell can refuse to close mid-save.
  const [locked, setLocked] = useState(false);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent className="sc-dialog">
        {target !== null ? (
          <DialogBody key={target.variant.id} target={target} onClose={onClose} onLockChange={setLocked} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function variantLabel(target: StockAdjustTarget): { name: string; sku: string | null } {
  const attributes = target.variant.attributes ? Object.values(target.variant.attributes).join(' / ') : '';
  return { name: attributes.length > 0 ? attributes : (target.variant.sku ?? 'Variant'), sku: target.variant.sku };
}

function DialogTitleFor({ target }: { target: StockAdjustTarget }): ReactElement {
  const { name, sku } = variantLabel(target);
  return (
    <DialogTitle>
      Adjust stock - {name}{' '}
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

function DialogBody({
  target,
  onClose,
  onLockChange,
}: {
  target: StockAdjustTarget;
  onClose: () => void;
  onLockChange: (locked: boolean) => void;
}): ReactElement {
  // One key for the dialog's lifetime: the body is keyed by variant, so a new
  // open is a new key and a retry inside one open is the same one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const targetQuery = useCorrectionTargetQuery(target.variant.id);
  const mutation = useCorrectStockMutation();
  const [ackedDelta, setAckedDelta] = useState<number | null>(null);
  const [serverConfirmDelta, setServerConfirmDelta] = useState<number | null>(null);

  const form = useForm<StockCorrectionFormValues>({
    defaultValues: STOCK_CORRECTION_DEFAULT_VALUES,
    resolver: zodResolver(stockCorrectionSchema),
  });
  const values = form.watch();

  const correctionTarget = targetQuery.data ?? null;
  const ready = correctionTarget !== null && correctionTarget.kind === 'ready' ? correctionTarget : null;
  const current = ready?.currentQuantity ?? null;
  const masterName = ready?.connectionName ?? 'the master';

  const entry = readEntry(values);
  const entryValid = entry !== null && (values.mode === 'delta' ? entry !== 0 : entry >= 0);
  const delta = current !== null && entry !== null && entryValid ? correctionDelta(values.mode, entry, current) : null;
  const newQuantity = current !== null && delta !== null ? current + delta : null;
  const needsConfirmation =
    delta !== null && current !== null && (isLargeChange(delta, current) || serverConfirmDelta === delta);
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
    try {
      await mutation.mutateAsync({
        productVariantId: target.variant.id,
        input: toCorrectStockInput(formValues, parsed, idempotencyKey, ackedDelta === sentDelta),
      });
    } catch (error) {
      if (errorCode(error instanceof Error ? error : null) === 'confirmation-required') {
        // The server's thresholds can differ from ours when the current stock
        // moved; same key, the operator just has to tick the box.
        setServerConfirmDelta(sentDelta);
      }
    }
  });

  if (pending) {
    return (
      <div data-testid="stock-correction-applying">
        <DialogTitleFor target={target} />
        <DialogDescription>
          {current ?? '?'} → {newQuantity ?? '?'} · {REASON_LABEL[values.reason]}
        </DialogDescription>
        <dl className="key-value-list">
          <dt className="key-value-list__label">Writes to</dt>
          <dd className="key-value-list__value">{ready?.connectionName ?? 'the master connection'}</dd>
        </dl>
        <DialogFooter>
          <Button tone="secondary" disabled>
            Cancel
          </Button>
          <Button disabled>
            <span className="button__spinner" aria-hidden="true"></span>Saving to {masterName}…
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
        <DialogDescription>Checking which connection owns this stock…</DialogDescription>
      </>
    );
  }

  if (targetQuery.isError || correctionTarget === null) {
    return (
      <>
        <DialogTitleFor target={target} />
        <Alert tone="error" title="Could not check where this stock lives" data-testid="stock-correction-target-error">
          {targetQuery.error?.message ?? 'The request failed.'}
        </Alert>
        <DialogFooter>
          <DialogClose asChild>
            <Button tone="secondary">Close</Button>
          </DialogClose>
          <Button onClick={() => { void targetQuery.refetch(); }}>Retry</Button>
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
      : (INLINE_ERROR_COPY[code ?? ''] ?? mutation.error.message);

  return (
    <div data-testid="stock-correction-dialog">
      <DialogTitleFor target={target} />
      <DialogDescription>
        This writes to {ready?.connectionName ?? 'the master'}, the master connection for this product. Channels
        update on their own once it confirms.
      </DialogDescription>

      <form onSubmit={(event) => { void submit(event); }} noValidate className="sc-form">
        {inlineError ? (
          <Alert tone="error" title="Could not save the correction" data-testid="stock-correction-error">
            {inlineError}
          </Alert>
        ) : null}

        <div className="form-field">
          <span className="form-field__label" id="sc-mode-label">
            How do you want to enter it?
          </span>
          <SegmentedControl
            aria-labelledby="sc-mode-label"
            value={values.mode}
            onChange={(mode) => form.setValue('mode', mode, { shouldValidate: form.formState.submitCount > 0 })}
            options={[
              { value: 'set', label: <span data-testid="stock-correction-mode-set">Set new quantity</span> },
              { value: 'delta', label: <span data-testid="stock-correction-mode-delta">Adjust by amount</span> },
            ]}
          />
        </div>

        {values.mode === 'set' ? (
          <FormField
            label="New quantity"
            name="quantity"
            error={form.formState.errors.quantity?.message}
            description={`Currently ${current ?? '?'} in ${masterName}.${heldSentence(target)}`}
          >
            <Input type="number" min={0} step={1} inputMode="numeric" data-testid="stock-correction-quantity" {...form.register('quantity')} />
          </FormField>
        ) : (
          <FormField
            label="Change by"
            name="delta"
            error={form.formState.errors.delta?.message}
            description="Use a minus sign to reduce stock, e.g. -2."
          >
            <Input type="text" inputMode="numeric" data-testid="stock-correction-delta" {...form.register('delta')} />
          </FormField>
        )}

        <p className="sc-diff" data-testid="stock-correction-diff">
          {current ?? '?'} → {newQuantity === null ? '…' : <ins>{newQuantity}</ins>}
        </p>

        {needsConfirmation ? (
          <Alert tone="warning" title="This is a large change" data-testid="stock-correction-large-change">
            It changes stock by more than 50 units or more than half of the current count. Check the number
            before saving.
            <label className="sc-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAckedDelta(event.target.checked ? delta : null)}
                data-testid="stock-correction-large-change-confirm"
              />{' '}
              I checked this number
            </label>
          </Alert>
        ) : null}

        <FormField label="Reason" name="reason">
          <Select data-testid="stock-correction-reason" {...form.register('reason')}>
            {CorrectionReasonValues.map((reason) => (
              <option key={reason} value={reason}>
                {REASON_LABEL[reason]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label={values.reason === 'other' ? 'Note (required for Other)' : 'Note (optional)'}
          name="note"
          error={form.formState.errors.note?.message}
          description={`For your team - ${masterName} doesn't receive this note.`}
        >
          <Textarea rows={2} maxLength={NOTE_MAX_LENGTH} data-testid="stock-correction-note" {...form.register('note')} />
        </FormField>

        <dl className="key-value-list">
          <dt className="key-value-list__label">Writes to</dt>
          <dd className="key-value-list__value" data-testid="stock-correction-target">
            {ready?.connectionName} <span className="text-muted">(this product&apos;s master connection)</span>
          </dd>
        </dl>

        <PreviewSection preview={preview} masterName={masterName} stockKnown={target.stock !== null} />

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={onClose} data-testid="stock-correction-cancel">
            Cancel
          </Button>
          <Button type="submit" disabled={submitDisabled} data-testid="stock-correction-submit">
            Save correction
          </Button>
        </DialogFooter>
      </form>
    </div>
  );
}

function heldSentence(target: StockAdjustTarget): string {
  const held = target.stock?.heldCounted;
  if (held === null || held === undefined) return '';
  return held > 0 ? ` OpenLinker holds ${held} of them for open orders.` : '';
}

function channelHow(channel: ChannelPreview): string {
  const parts: string[] = [];
  parts.push(
    channel.stockSafetyBuffer > 0
      ? `Publishes available to promise minus a ${channel.stockSafetyBuffer}-unit safety buffer for this connection.`
      : 'Publishes available to promise as-is.',
  );
  if (channel.stockZeroThreshold > 0) {
    parts.push(`Anything under ${channel.stockZeroThreshold} units is shown as sold out.`);
  }
  return parts.join(' ');
}

function qty(value: number | null): ReactNode {
  return value === null ? 'Unknown' : value;
}

function PreviewSection({
  preview,
  masterName,
  stockKnown,
}: {
  preview: CorrectionPreview | null;
  masterName: string;
  stockKnown: boolean;
}): ReactElement {
  return (
    <>
      <p className="sc-section-head">What channels will publish after this</p>
      {preview === null ? (
        <p className="sc-footnote" data-testid="stock-correction-preview">
          Enter a quantity to see what each channel will publish.
        </p>
      ) : !stockKnown ? (
        <p className="sc-footnote" data-testid="stock-correction-preview">
          Channel figures are unavailable right now, so no preview is shown. The correction itself is not affected.
        </p>
      ) : (
        <ul className="sc-impact" data-testid="stock-correction-preview">
          <li className="sc-impact__row" data-testid="stock-correction-preview-master">
            <span className="sc-impact__what">
              {masterName}
              <span className="sc-impact__sub">master</span>
            </span>
            <span className="sc-impact__how">Shows the corrected count directly.</span>
            <span className="sc-impact__qty">{preview.masterQuantity}</span>
          </li>
          <li className="sc-impact__row" data-testid="stock-correction-preview-atp">
            <span className="sc-impact__what">
              Available to promise
              <span className="sc-impact__sub">what channels start from</span>
            </span>
            <span className="sc-impact__how">
              {preview.heldCounted === null
                ? "OpenLinker couldn't read its holds for open orders, so this is not known."
                : `New count minus the ${preview.heldCounted} units OpenLinker holds for open orders.`}
            </span>
            <span className="sc-impact__qty">{qty(preview.availableToPromise)}</span>
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
              <span className="sc-impact__how">{channelHow(channel)}</span>
              <span className="sc-impact__qty">{qty(channel.quantity)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="sc-footnote">Marketplaces usually catch up within a minute of the master confirming.</p>
    </>
  );
}

function TargetRefusedView({
  target,
  reason,
  onClose,
}: {
  target: StockAdjustTarget;
  reason: keyof typeof TARGET_REFUSAL_COPY;
  onClose: () => void;
}): ReactElement {
  const copy = TARGET_REFUSAL_COPY[reason];
  return (
    <div data-testid="stock-correction-target-refused">
      <DialogTitleFor target={target} />
      <Alert tone="error" title={copy.title} data-testid="stock-correction-target-refused-reason">
        {copy.body}
      </Alert>
      <DialogFooter>
        <Button tone="secondary" onClick={onClose} data-testid="stock-correction-close">
          Close
        </Button>
      </DialogFooter>
    </div>
  );
}

function ResultView({
  result,
  target,
  reason,
  onClose,
  previewFor,
}: {
  result: CorrectStockResult;
  target: StockAdjustTarget;
  reason: StockCorrectionFormValues['reason'];
  onClose: () => void;
  previewFor: (quantity: number) => CorrectionPreview;
}): ReactElement {
  const master = result.master.connectionName;
  const before = result.quantityBefore;
  const attemptedTo = before === null ? null : before + result.requestedDelta;
  const { name, sku } = variantLabel(target);

  if (result.status === 'applied') {
    const after = result.quantityAfter ?? attemptedTo;
    const channels = after === null ? [] : previewFor(after).channels;
    const appliedAt = result.adjustmentOutcome?.appliedAt ?? null;
    return (
      <div data-testid="stock-correction-applied">
        <DialogTitle>
          Stock updated{' '}
          <StatusBadge tone="success" data-testid="stock-correction-confirmed">
            Confirmed
          </StatusBadge>
        </DialogTitle>
        <DialogDescription>
          {master} confirmed the new count for {name}.
          {result.deduplicated ? ' This correction had already been recorded, so nothing was sent again.' : ''}
        </DialogDescription>
        <dl className="key-value-list">
          <dt className="key-value-list__label">Variant</dt>
          <dd className="key-value-list__value mono-text">{sku ?? name} · {name}</dd>
          <dt className="key-value-list__label">Quantity</dt>
          <dd className="key-value-list__value">
            {before ?? '?'} → <ins>{after ?? '?'}</ins>
          </dd>
          <dt className="key-value-list__label">Reason</dt>
          <dd className="key-value-list__value">{REASON_LABEL[reason]}</dd>
          <dt className="key-value-list__label">Master</dt>
          <dd className="key-value-list__value">{master}</dd>
          {appliedAt ? (
            <>
              <dt className="key-value-list__label">Confirmed at</dt>
              <dd className="key-value-list__value" data-testid="stock-correction-applied-at">
                <TimeDisplay iso={appliedAt} />
              </dd>
            </>
          ) : null}
          {channels.length > 0 ? (
            <>
              <dt className="key-value-list__label">Channels</dt>
              <dd className="key-value-list__value" data-testid="stock-correction-applied-channels">
                {channels.map((channel) => `${channel.connectionName} will publish ${channel.quantity ?? 'an unknown amount'}`).join(', ')}
                {' - '}usually within a minute.
              </dd>
            </>
          ) : null}
        </dl>
        <DialogFooter>
          <Button onClick={onClose} data-testid="stock-correction-done">
            Done
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
          Attempted: {before ?? '?'} → {attemptedTo ?? '?'} · {REASON_LABEL[reason]}{' '}
          <StatusBadge tone="error">Not applied</StatusBadge>
        </p>
        <Alert tone="error" title={`${master} refused this change`} data-testid="stock-correction-refused-reason">
          {result.refusal?.detail ?? 'The master did not accept the change and gave no reason.'}
        </Alert>
        <DialogFooter>
          <Button tone="secondary" onClick={onClose} data-testid="stock-correction-close">
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div data-testid="stock-correction-in-doubt">
      <DialogTitleFor target={target} />
      <p className="sc-attempt">
        Sent: {before ?? '?'} → {attemptedTo ?? '?'} · {REASON_LABEL[reason]}
      </p>
      <Alert tone="warning" title={`We couldn't confirm this reached ${master}`}>
        OpenLinker lost contact right after sending this correction. It may already be applied.
      </Alert>
      <p className="form-field__description" style={{ marginTop: 'var(--space-2)' }}>
        Check {master}&apos;s own stock number before deciding what to do next. Filling in this form again would
        start a brand-new correction, which could double the change if the first one did land.
      </p>
      <DialogFooter>
        <Button tone="secondary" onClick={onClose} data-testid="stock-correction-close">
          Close
        </Button>
      </DialogFooter>
    </div>
  );
}
