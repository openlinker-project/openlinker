/**
 * Return Receive Form (#2380)
 *
 * The inline per-line receive flow (returns spec § 5.2).
 *
 * **An inline expansion, not a modal**, and that is the spec's own adjudication
 * rather than a style preference: a modal on a tablet with a parcel in one hand
 * hides the advised quantities the operator is typing against.
 *
 * **The over-receipt bound is derived from the same counters the server
 * checks**, and its refusal sentence is the spec's, held in one copy map with
 * the server's 409 mapping. The client guard exists so the operator is told
 * before they submit; the server stays the authority, and its refusal is
 * rendered rather than swallowed — a client guard that disagreed would
 * otherwise silently become the only one.
 *
 * **Declared departure from `frontend-ui-style-guide.md`** (spec § 5.2): this
 * form carries no *"open on desktop"* hint and stays fully interactive at
 * 768 px, because the tablet IS the primary device for this task. Its controls
 * carry an explicit `min-height` rather than inheriting the global 44 px floor,
 * which is keyed on `(pointer: coarse)` — a pointer test, not a width test — and
 * so does not fire for a 768 px desktop window or in a component test. Do not
 * "simplify" that back to the global rule: it would make the ≥44 px guarantee a
 * claim nothing proves.
 *
 * @module apps/web/src/features/returns/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, type ReactElement } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod/v4';

import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Textarea } from '../../../shared/ui/textarea';
import { useMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { outstandingToReceive } from '../lib/return-line-quantities';
import type { ReturnLine } from '../api/returns.types';

interface ReturnReceiveFormProps {
  line: ReturnLine;
  pending: boolean;
  /** The server's own refusal, rendered verbatim above the fields. */
  error: string | null;
  onSubmit: (input: { quantity: number; note?: string }) => void;
  onCancel: () => void;
}

/**
 * Built per line, because the upper bound IS this line's outstanding quantity.
 *
 * A shared schema with the bound passed in at submit time would move the check
 * out of the resolver, which is where the operator sees it as a field error
 * rather than as a failed request.
 */
type ReceiveCopy = ResolvedCopy<Messages['returns']>['custody']['receive'];

function createReceiveSchema(copy: ReceiveCopy, outstanding: number) {
  return z.object({
    quantity: z
      .number({ error: copy.nonPositive })
      .int(copy.notWholeUnits)
      .min(1, copy.nonPositive)
      // The spec's sentence, and the same bound the server enforces.
      .max(outstanding, copy.overReceipt),
    note: z.string().max(500).optional(),
  });
}

type ReceiveFormValues = { quantity: number; note?: string };

export function ReturnReceiveForm({
  line,
  pending,
  error,
  onSubmit,
  onCancel,
}: ReturnReceiveFormProps): ReactElement {
  const copy = useMessages('returns').custody.receive;
  const outstanding = outstandingToReceive(line);
  const schema = useMemo(() => createReceiveSchema(copy, outstanding), [copy, outstanding]);

  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = useForm<ReceiveFormValues>({
    resolver: zodResolver(schema),
    // The common case is one press: everything still outstanding arrived.
    defaultValues: { quantity: outstanding, note: '' },
  });

  // A concurrent write (another operator, or the bulk action) moves the
  // outstanding quantity under this form. Re-defaulting on that change keeps
  // the prefilled value from becoming a silent over-receipt.
  useEffect(() => {
    reset({ quantity: outstanding, note: '' });
  }, [outstanding, reset]);

  const submit: SubmitHandler<ReceiveFormValues> = (values) => {
    onSubmit({ quantity: values.quantity, note: values.note });
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

      {/* Disabled wholesale while the write is in flight, so no field can be
          edited into disagreement with the request already on the wire. */}
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

        <FormField error={errors.note?.message} label={copy.noteLabel} name="note">
          <Textarea
            placeholder={copy.notePlaceholder}
            rows={2}
            {...register('note')}
          />
        </FormField>

        <div className="return-custody-form__actions">
          <Button type="submit">
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
