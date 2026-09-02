/**
 * Refund Confirmation Form (#2382, returns spec § 5.7)
 *
 * The first `RefundRecord` UI the product has ever had.
 *
 * **It lives in `orders`, not `returns`.** `refund_records` is an orders table
 * and `IOrderRefundService` an orders service, so orders owns the concept; the
 * return money panel is merely its first consumer, and the order-level capture
 * path is the second. It is exported from the orders barrel and imported
 * cross-feature as `from '../../orders'` — the #2100 shape. It could NOT live in
 * `shared/`: `frontend-architecture.md` forbids `shared` importing `features`
 * and requires shared UI to stay domain-agnostic, and a form built from
 * `RefundReason`, a locked currency and a `RefundRecord` shape is the opposite
 * of domain-agnostic.
 *
 * Three rules, each because its opposite states something false.
 *
 * **The label is `Confirm refund`, never `Refund`.** OpenLinker ships no refund
 * WRITE; the operator moved the money and this records that they did. The
 * shorter label claims OpenLinker performed it.
 *
 * **The amount starts EMPTY and is never computed.** `ReturnLine` carries no
 * price, `resolvedOrderLineId` is populated by nothing, and a sku match against
 * the order's items is *available* — which is what makes it dangerous, since two
 * lines of one return can share a sku. Prefilling from that would put a money
 * figure derived from a coincidence on the one surface where being wrong moves
 * real money. The order total renders beside the field as LABELLED CONTEXT,
 * never as a value in the input. And the label settles it regardless of
 * computability: confirming an amount the operator already sent means
 * OpenLinker should not be proposing one.
 *
 * **Currency is display-only, and that lock is the ONLY protection.** There is
 * no refund-side currency-mismatch guard anywhere in the tree — the only
 * `currency-mismatch` belongs to `sales-documents`' threshold evaluator, an
 * unrelated rule. `currency` is a required, ISO-4217-validated input, so nothing
 * downstream catches a wrong one. With no order currency resolved the form
 * refuses rather than accepting a typed value.
 *
 * @module apps/web/src/features/orders/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactElement } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod/v4';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { Textarea } from '../../../shared/ui/textarea';
import {
  REFUND_REASON_LABELS,
  REFUND_REASON_VALUES,
  type RefundReason,
} from '../lib/refund-reason';
import { REFUND_CONFIRMATION_COPY } from '../lib/refund-confirmation.copy';

export interface RefundConfirmationSubmission {
  amount: string;
  reason: RefundReason;
  note?: string;
}

interface RefundConfirmationFormProps {
  /**
   * The order's currency. `null` means it could not be resolved — the form then
   * refuses rather than accepting a typed one, because the lock is the only
   * protection against a wrong currency reaching `RefundRecord`.
   */
  currency: string | null;
  /** Rendered BESIDE the amount as context. Never placed in the input. */
  orderTotal?: string | null;
  pending: boolean;
  error: string | null;
  onSubmit: (input: RefundConfirmationSubmission) => void;
  onCancel?: () => void;
}

const schema = z.object({
  // A decimal STRING, never a number: `RefundRecord.amount` is `numeric(12,2)`
  // and round-tripping money through a float is how cents disappear.
  amount: z
    .string()
    .trim()
    .min(1, REFUND_CONFIRMATION_COPY.amountRequired)
    .regex(/^\d+(\.\d{1,2})?$/, REFUND_CONFIRMATION_COPY.amountInvalid),
  reason: z.enum(REFUND_REASON_VALUES),
  note: z.string().max(500).optional(),
});

type RefundFormValues = z.infer<typeof schema>;

export function RefundConfirmationForm({
  currency,
  orderTotal = null,
  pending,
  error,
  onSubmit,
  onCancel,
}: RefundConfirmationFormProps): ReactElement {
  const {
    formState: { errors },
    handleSubmit,
    register,
  } = useForm<RefundFormValues>({
    resolver: zodResolver(schema),
    // EMPTY. See the module docblock — this is a decision, not a gap.
    defaultValues: { amount: '', reason: 'withdrawal', note: '' },
  });

  const submit: SubmitHandler<RefundFormValues> = (values) => {
    onSubmit({ amount: values.amount, reason: values.reason, note: values.note });
  };

  const messages = [
    ...(error !== null ? [error] : []),
    ...Object.values(errors)
      .map((fieldError) => fieldError?.message)
      .filter((message): message is string => typeof message === 'string'),
  ];

  if (currency === null) {
    // Refused, not degraded to a typed input: nothing downstream would catch a
    // wrong currency, so accepting one here is how a RefundRecord ends up
    // disagreeing with the money that actually moved.
    return <Alert tone="warning">{REFUND_CONFIRMATION_COPY.noCurrency}</Alert>;
  }

  return (
    <form
      className="refund-confirmation-form"
      noValidate
      onSubmit={(event) => {
        // Discarded explicitly: the validation path is synchronous and `submit`
        // never rejects, so there is nothing to await.
        void handleSubmit(submit)(event);
      }}
    >
      <p className="refund-confirmation-form__preamble">
        {REFUND_CONFIRMATION_COPY.preamble}
      </p>

      <FormErrorSummary errors={messages} title={REFUND_CONFIRMATION_COPY.heading} />

      <fieldset className="refund-confirmation-form__fields" disabled={pending}>
        <FormField
          description={REFUND_CONFIRMATION_COPY.amountHint}
          error={errors.amount?.message}
          label={`${REFUND_CONFIRMATION_COPY.amountLabel} (${currency})`}
          name="amount"
        >
          <Input inputMode="decimal" placeholder="0.00" {...register('amount')} />
        </FormField>

        {/* Context, never a suggestion — and labelled as the ORDER total so it
            cannot be misread as an amount OpenLinker computed for this refund. */}
        {orderTotal !== null ? (
          <p className="refund-confirmation-form__context text-muted">
            {REFUND_CONFIRMATION_COPY.orderTotalLabel} {orderTotal} {currency}
          </p>
        ) : null}

        <FormField
          error={errors.reason?.message}
          label={REFUND_CONFIRMATION_COPY.reasonLabel}
          name="reason"
        >
          <Select {...register('reason')}>
            {REFUND_REASON_VALUES.map((reason) => (
              <option key={reason} value={reason}>
                {REFUND_REASON_LABELS[reason]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          error={errors.note?.message}
          label={REFUND_CONFIRMATION_COPY.noteLabel}
          name="note"
        >
          <Textarea rows={2} {...register('note')} />
        </FormField>

        <div className="refund-confirmation-form__actions">
          <Button type="submit">
            {pending
              ? REFUND_CONFIRMATION_COPY.pending
              : REFUND_CONFIRMATION_COPY.submit}
          </Button>
          {onCancel !== undefined ? (
            <Button onClick={onCancel} tone="secondary" type="button">
              {REFUND_CONFIRMATION_COPY.cancel}
            </Button>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}
