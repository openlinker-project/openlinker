/**
 * Return Dispose Form (#2380)
 *
 * The inline per-line disposition flow (returns spec § 5.3).
 *
 * **A two-option segmented control, not a dropdown** — the spec's reasoning is
 * that there will never be a third in this wave, and a dropdown hides one of
 * two options behind a click.
 *
 * **Where the stock goes is NAMED, not implied.** The destination sentence
 * comes from the backend-resolved `restockTarget`, which is answered by the same
 * resolver the write uses — so the name shown and the book written cannot
 * disagree. Where no single master resolves, the form says so plainly and
 * disables `Restock` rather than offering a write that is going to be refused:
 * an ambiguous master is a BLOCKED restock, not a pick, so naming a candidate
 * would promise something OpenLinker has already decided not to do.
 *
 * **The note is free text on purpose** (§ 3.1) — "scuffed box" goes here, and it
 * is deliberately not a graded condition vocabulary.
 *
 * Carries the same declared style-guide departure and explicit ≥44 px control
 * height as the receive form; see that module's docblock.
 *
 * @module apps/web/src/features/returns/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod/v4';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Textarea } from '../../../shared/ui/textarea';
import { BundleReturnPicker } from './bundle-return-picker';
import { usePlural, useMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { outstandingToDispose } from '../lib/return-line-quantities';
import { describeRestockTarget, isRestockAvailable } from '../lib/restock-target';
import type { ReturnDisposition, ReturnLine, ReturnRestockTarget } from '../api/returns.types';

interface ReturnDisposeFormProps {
  line: ReturnLine;
  restockTarget: ReturnRestockTarget;
  /** An orphan return restocks nothing — the server refuses it (409). */
  isOrphan: boolean;
  /**
   * The line already has an outstanding (`blocked` / `in_doubt`) restock act,
   * and the server refuses a second restock until it is attested (#3466, 409
   * `restock-already-blocked`). Scrap is unaffected on the server, so only the
   * `Restock` option is disabled here, never the whole form.
   */
  restockBlocked: boolean;
  pending: boolean;
  error: string | null;
  /**
   * Present only where the line may be a bundle (#3933): the picker then asks the
   * server whether it is and, if so, which components came back. Omitted by
   * callers that have no return to ask about.
   */
  bundleScope?: { returnId: string; currency: string | null };
  onSubmit: (input: {
    quantity: number;
    disposition: ReturnDisposition;
    note?: string;
    returnedVariantIds?: string[];
  }) => void;
  onCancel: () => void;
}

type DisposeCopy = ResolvedCopy<Messages['returns']>['custody']['dispose'];

function createDisposeSchema(copy: DisposeCopy, outstanding: number, overDisposition: string) {
  return z.object({
    quantity: z
      .number({ error: copy.nonPositive })
      .int(copy.notWholeUnits)
      .min(1, copy.nonPositive)
      .max(outstanding, overDisposition),
    disposition: z.enum(['restock', 'scrap']),
    note: z.string().max(500).optional(),
  });
}

type DisposeFormValues = { quantity: number; disposition: ReturnDisposition; note?: string };

export function ReturnDisposeForm({
  line,
  restockTarget,
  isOrphan,
  restockBlocked,
  pending,
  error,
  bundleScope,
  onSubmit,
  onCancel,
}: ReturnDisposeFormProps): ReactElement {
  const copy = useMessages('returns').custody.dispose;
  const plural = usePlural();
  const outstanding = outstandingToDispose(line);
  const overDisposition = plural(outstanding, copy.overDisposition);
  const schema = useMemo(
    () => createDisposeSchema(copy, outstanding, overDisposition),
    [copy, outstanding, overDisposition]
  );
  // Three independent reasons a restock cannot land, kept separate because they
  // are different facts with different remedies: no single master is a
  // configuration problem, an orphan is a matching problem, and an outstanding
  // block is waiting on the operator's attestation (#3466).
  const restockPossible = isRestockAvailable(restockTarget) && !isOrphan && !restockBlocked;

  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
  } = useForm<DisposeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantity: outstanding,
      // Never defaults to an option that cannot be submitted.
      disposition: restockPossible ? 'restock' : 'scrap',
      note: '',
    },
  });

  const disposition = watch('disposition');
  const watchedQuantity = watch('quantity');
  const [returnedVariantIds, setReturnedVariantIds] = useState<string[] | undefined>(undefined);
  const [bundleBlocked, setBundleBlocked] = useState(false);
  const onSelectionChange = useCallback(
    (ids: string[] | undefined) => setReturnedVariantIds(ids),
    []
  );
  const onBlockedChange = useCallback((blocked: boolean) => setBundleBlocked(blocked), []);

  useEffect(() => {
    reset({
      quantity: outstanding,
      disposition: restockPossible ? 'restock' : 'scrap',
      note: '',
    });
  }, [outstanding, reset, restockPossible]);

  const submit: SubmitHandler<DisposeFormValues> = (values) => {
    if (values.disposition === 'restock' && bundleBlocked) {
      return;
    }
    onSubmit({
      quantity: values.quantity,
      disposition: values.disposition,
      note: values.note,
      // Only a restock reads the selection; a scrap writes off the whole line.
      ...(values.disposition === 'restock' && returnedVariantIds !== undefined
        ? { returnedVariantIds }
        : {}),
    });
  };

  const messages = [
    ...(error !== null ? [error] : []),
    ...Object.values(errors)
      .map((fieldError) => fieldError?.message)
      .filter((message): message is string => typeof message === 'string'),
  ];

  return (
    <form
      className="return-custody-form"
      noValidate
      onSubmit={(event) => {
        // `handleSubmit` returns a promise, and an attribute expecting `void`
        // gives its rejection nowhere to go. Discarded explicitly rather than
        // silenced: the validation path is synchronous and `submit` itself
        // never rejects, so there is genuinely nothing to await here.
        void handleSubmit(submit)(event);
      }}
    >
      <FormErrorSummary errors={messages} title={copy.heading} />

      <fieldset className="return-custody-form__fields" disabled={pending}>
        <FormField
          description={copy.quantityHint}
          error={errors.quantity?.message}
          label={copy.quantityLabel}
          name="quantity"
        >
          <Input
            inputMode="numeric"
            max={outstanding}
            min={1}
            step={1}
            type="number"
            {...register('quantity', { valueAsNumber: true })}
          />
        </FormField>

        <div className="return-custody-form__disposition">
          <span className="form-field__label" id="dispose-disposition-label">
            {copy.dispositionLabel}
          </span>
          <SegmentedControl
            aria-labelledby="dispose-disposition-label"
            onChange={(value) => setValue('disposition', value)}
            options={[
              {
                value: 'restock' as const,
                label: copy.restockLabel,
                disabled: !restockPossible,
              },
              { value: 'scrap' as const, label: copy.scrapLabel },
            ]}
            value={disposition}
          />

          {/* The explanation of the SELECTED option, plus — for restock — the
              destination. Rendered under the control rather than as a tooltip:
              this is the one thing an operator gets wrong, per § 5.3. */}
          <p className="return-custody-form__help text-muted">
            {disposition === 'restock'
              ? copy.restockHelp
              : copy.scrapHelp}
          </p>

          {/* Under `restock`, this NAMES the destination. When restock is
              unavailable it is shown regardless of the selected option, because
              it is then the explanation for why that option is disabled — and
              an operator who never selects the disabled option would otherwise
              never be told. The orphan case has its own alert below: it is a
              matching problem, not a configuration one. */}
          {disposition === 'restock' || !isRestockAvailable(restockTarget) ? (
            <p
              className={
                isRestockAvailable(restockTarget)
                  ? 'return-custody-form__destination'
                  : 'return-custody-form__destination return-custody-form__destination--unavailable'
              }
            >
              {describeRestockTarget(restockTarget)}
            </p>
          ) : null}

          {bundleScope !== undefined && disposition === 'restock' && restockPossible ? (
            <BundleReturnPicker
              currency={bundleScope.currency}
              lineId={line.id}
              onBlockedChange={onBlockedChange}
              onSelectionChange={onSelectionChange}
              quantity={Number.isFinite(watchedQuantity) ? watchedQuantity : 1}
              returnId={bundleScope.returnId}
            />
          ) : null}

          {/* Stated up front, not discovered by submitting into a 409. */}
          {isOrphan ? <Alert tone="warning">{copy.orphanBlocked}</Alert> : null}
          {restockBlocked && !isOrphan ? (
            <Alert tone="warning">{copy.awaitingAttestation}</Alert>
          ) : null}
        </div>

        <FormField error={errors.note?.message} label={copy.noteLabel} name="note">
          <Textarea
            placeholder={copy.notePlaceholder}
            rows={2}
            {...register('note')}
          />
        </FormField>

        <div className="return-custody-form__actions">
          <Button disabled={disposition === 'restock' && bundleBlocked} type="submit">
            {pending ? copy.pending : copy.submit}
          </Button>
          <Button onClick={onCancel} tone="secondary" type="button">
            {copy.cancel}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
