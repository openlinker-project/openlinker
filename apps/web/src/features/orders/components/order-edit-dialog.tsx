/**
 * Order Edit Dialog (#3544, mockup M1 `edit-form` / `edit-review` / `edit-blocked`)
 *
 * One dialog over the four edit endpoints (shipping address, delivery method,
 * line quantities, discount). The operator changes what they need, "Review
 * changes" runs every changed section as a **dry run** and renders the server's
 * before/after (`OrderEditReview`), and "Save changes" sends the same bodies for
 * real. An edit is confirmed immediately (D9): there is no pending state and the
 * channel is never asked.
 *
 * **The server decides, and its reason is shown.** A refusal renders in the
 * `edit-blocked` layout with the server's own sentence and a remedy that points
 * at the control that fixes it (`order-edit.ts`). The sections a refusal locks
 * are disabled, so the operator can still change what is allowed. The form
 * mirrors the quantity and discount rules only to tell the operator while typing.
 *
 * **Saving is one request per changed section and is not atomic.** If a later one
 * is refused, the earlier ones stand, the dialog says which, and a retry sends
 * only what is still different (a section already saved reads as unchanged).
 *
 * The acting user is never sent: the backend stamps it from the session.
 *
 * @module apps/web/src/features/orders/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { formatAmount } from '../../../shared/format/format-amount';
import type { ParsedOrderSnapshot } from '../api/order-snapshot.schema';
import type { OrderEditsView } from '../api/order-edit.types';
import {
  useEditOrderMutation,
  type EditOrderOutput,
} from '../hooks/use-edit-order-mutation';
import { readRefundCeilingFigures, readServerReason, remainingRefundable } from '../lib/order-cancel';
import {
  classifyOrderEditRefusal,
  lockedSectionsFor,
  ORDER_EDIT_REFUSAL_COPY,
  ORDER_EDIT_SECTION_LABELS,
  readOrderEditErrorCode,
  type OrderEditErrorCode,
  type OrderEditRemedyTarget,
  type OrderEditSection,
} from '../lib/order-edit';
import {
  buildOrderEditInitialValues,
  buildOrderEditLineMeta,
  buildOrderEditSchema,
  detectChangedSections,
  planOrderEdits,
  type OrderEditFormValues,
  type PlannedOrderEdit,
} from './order-edit-dialog.schema';
import { OrderEditRefusal } from './order-edit-refusal';
import { OrderEditReview, type OrderEditDryRun } from './order-edit-review';

export interface OrderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  internalOrderId: string;
  /** The source's own order number, for the title. Falls back to the internal id. */
  orderNumber: string | null;
  /** Display name of the source connection, e.g. "Allegro · ceramika_nowak". */
  sourceName: string | null;
  /** The order as it is now (already the edited view). */
  snapshot: ParsedOrderSnapshot;
  /** The order beside the channel's record, when it has been edited before. */
  edits: OrderEditsView | null | undefined;
  /** A refusal the page can predict before any call (a packed order), shown on open. */
  predictedRefusal: OrderEditErrorCode | null;
  /** A holder already accepted or started work on this order (the soft gate). */
  acceptedWork: boolean;
  /** Every section was saved; the outputs are the server's answers, in the order sent. */
  onSaved: (outputs: readonly EditOrderOutput[]) => void;
  /** Close and scroll to the control a refusal's remedy points at. */
  onGoTo?: (target: OrderEditRemedyTarget) => void;
}

interface Failure {
  error: Error;
  /** The section whose request the server refused. */
  section: OrderEditSection | null;
  /** Sections saved before this one was refused. Empty for a dry run. */
  saved: readonly OrderEditSection[];
}

type Step = 'form' | 'review';

export function OrderEditDialog({
  open,
  onOpenChange,
  internalOrderId,
  orderNumber,
  sourceName,
  snapshot,
  edits,
  predictedRefusal,
  acceptedWork,
  onSaved,
  onGoTo,
}: OrderEditDialogProps): ReactElement {
  const mutation = useEditOrderMutation();
  const initial = useMemo(() => buildOrderEditInitialValues(snapshot, edits), [snapshot, edits]);
  const lineMeta = useMemo(() => buildOrderEditLineMeta(snapshot, edits), [snapshot, edits]);
  const schema = useMemo(
    () =>
      buildOrderEditSchema(
        initial,
        Object.fromEntries(lineMeta.map((meta) => [meta.orderLineId, meta.maxQuantity])),
      ),
    [initial, lineMeta],
  );
  const form = useForm<OrderEditFormValues>({
    defaultValues: initial,
    resolver: zodResolver(schema),
  });

  const [step, setStep] = useState<Step>('form');
  const [dryRuns, setDryRuns] = useState<OrderEditDryRun[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState<'reviewing' | 'saving' | null>(null);
  // The discount was filled in with a quantity change, so the quantities go first.
  const [discountDeferred, setDiscountDeferred] = useState(false);
  // The quantities were saved and the discount is still waiting for its own review.
  const [quantitiesSaved, setQuantitiesSaved] = useState(false);

  // Reset when the dialog OPENS, not whenever `initial` changes: a partly saved
  // edit refetches the order, and that must not wipe the refusal being shown.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetForm(initialRef.current);
      resetMutation();
      setStep('form');
      setDryRuns([]);
      setFailure(null);
      setBusy(null);
      setDiscountDeferred(false);
      setQuantitiesSaved(false);
    }
  }, [open, resetForm, resetMutation]);

  // The EFFECTIVE snapshot total is the edited one, so it is the channel's figure only
  // while nothing was edited; otherwise the server's `channelTotal` is the only truth.
  const paidOnChannel = edits?.totals
    ? { amount: edits.totals.channelTotal, currency: edits.totals.currency }
    : !edits && snapshot.totals
      ? { amount: snapshot.totals.total, currency: snapshot.totals.currency }
      : null;
  const title = orderNumber ?? internalOrderId;
  const channel = sourceName ?? 'the sales channel';
  const values = form.watch();
  const changed = detectChangedSections(values, initial);

  const failureCode = failure ? readOrderEditErrorCode(failure.error) : null;
  const failureView = failure ? classifyOrderEditRefusal(failureCode) : null;
  const ceiling = failure ? readRefundCeilingFigures(failure.error) : null;
  const refusalCode: OrderEditErrorCode | null =
    failureView === 'blocked' ? failureCode : failure === null ? predictedRefusal : null;
  const locked = lockedSectionsFor(refusalCode, failure?.section ?? null);
  const needsAck = (acceptedWork && changed.has('lines')) || failureView === 'needs-ack';
  const reviewDisabled =
    busy !== null || changed.size === 0 || [...changed].some((section) => locked.has(section));

  /**
   * What goes out now. A discount filled in beside a quantity change is held
   * back: its money would be worked out on the order as saved TODAY, not after
   * the new quantities, so it is previewed and saved on its own afterwards.
   */
  const planForNow = (
    submitted: OrderEditFormValues,
    dryRun: boolean,
  ): { plan: PlannedOrderEdit[]; deferred: boolean } => {
    const full = planOrderEdits(submitted, initial, { dryRun });
    const deferred =
      full.some((planned) => planned.section === 'lines') &&
      full.some((planned) => planned.section === 'discount');
    return {
      plan: deferred ? full.filter((planned) => planned.section !== 'discount') : full,
      deferred,
    };
  };

  const run = (planned: PlannedOrderEdit): Promise<EditOrderOutput> =>
    mutation.mutateAsync({ internalOrderId, edit: planned.edit });

  const review = form.handleSubmit(async (submitted: OrderEditFormValues): Promise<void> => {
    const { plan, deferred } = planForNow(submitted, true);
    if (plan.length === 0) return;
    setDiscountDeferred(deferred);
    setQuantitiesSaved(false);
    setFailure(null);
    setBusy('reviewing');
    const runs: OrderEditDryRun[] = [];
    let refusedSection: OrderEditSection | null = null;
    try {
      for (const planned of plan) {
        refusedSection = planned.section;
        runs.push({ section: planned.section, output: await run(planned) });
      }
      setDryRuns(runs);
      setStep('review');
    } catch (error) {
      setFailure({ error: error as Error, section: refusedSection, saved: [] });
    } finally {
      setBusy(null);
    }
  });

  const save = async (): Promise<void> => {
    const { plan, deferred } = planForNow(form.getValues(), false);
    setFailure(null);
    setBusy('saving');
    const saved: OrderEditSection[] = [];
    const outputs: EditOrderOutput[] = [];
    for (const planned of plan) {
      try {
        outputs.push(await run(planned));
        saved.push(planned.section);
      } catch (error) {
        // A section that already went in reads as "nothing changed" on a retry.
        if (readOrderEditErrorCode(error) === 'NOTHING_CHANGED') continue;
        setFailure({ error: error as Error, section: planned.section, saved });
        setStep('form');
        setBusy(null);
        if (saved.length > 0) onSaved(outputs);
        return;
      }
    }
    setBusy(null);
    onSaved(outputs);
    if (deferred) {
      // Stay open on the form: the discount is still filled in for its own review.
      setStep('form');
      setDryRuns([]);
      setDiscountDeferred(false);
      setQuantitiesSaved(true);
      return;
    }
    onOpenChange(false);
  };

  const errors = form.formState.errors;
  const linesErrors = errors.lines as { root?: { message?: string }; message?: string } | undefined;
  const linesRootError = linesErrors?.root?.message ?? linesErrors?.message;

  // ---- edit-review ---------------------------------------------------------
  if (open && step === 'review') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="dialog__content--wide order-hold-dialog"
          data-testid="order-edit-dialog"
        >
          <DialogTitle>{`Review changes to ${title}`}</DialogTitle>
          <DialogDescription>Check what changes and where it’s used before you save.</DialogDescription>
          <OrderEditReview
            dryRuns={dryRuns}
            lineMeta={lineMeta}
            channelName={sourceName}
            discountDeferred={discountDeferred}
          />
          <div className="dialog__footer dialog__footer--split">
            <Button
              type="button"
              tone="ghost"
              disabled={busy !== null}
              data-testid="order-edit-back"
              onClick={() => {
                setStep('form');
              }}
            >
              Back to editing
            </Button>
            <span className="dialog__footer-group">
              <DialogClose asChild>
                <Button
                  type="button"
                  tone="secondary"
                  disabled={busy === 'saving'}
                  data-testid="order-edit-discard"
                >
                  Discard
                </Button>
              </DialogClose>
              <Button
                type="button"
                tone="primary"
                disabled={busy !== null}
                data-testid="order-edit-save"
                onClick={() => {
                  void save();
                }}
              >
                {busy === 'saving' ? 'Saving…' : 'Save changes'}
              </Button>
            </span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- edit-form / edit-blocked ---------------------------------------------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="dialog__content--wide order-hold-dialog"
        data-testid="order-edit-dialog"
      >
        <DialogTitle>{`Edit order ${title}`}</DialogTitle>
        <DialogDescription>
          {`Your changes stay in OpenLinker and are used for the shipping label, the invoice and the pack bench. ${channel} keeps the order as the buyer placed it.`}
        </DialogDescription>

        {refusalCode !== null ? (
          <OrderEditRefusal
            code={refusalCode}
            reason={failure && failureView === 'blocked' ? readServerReason(failure.error, '') : null}
            savedSectionLabels={(failure?.saved ?? []).map((section) => ORDER_EDIT_SECTION_LABELS[section])}
            onGoTo={
              onGoTo
                ? (target) => {
                    onOpenChange(false);
                    onGoTo(target);
                  }
                : undefined
            }
          />
        ) : null}
        {failure && failureView !== 'blocked' ? <FailureAlert failure={failure} /> : null}
        {quantitiesSaved ? (
          <Alert tone="success" title="Quantities saved" data-testid="order-edit-quantities-saved">
            The discount is still filled in below. Review it now.
          </Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            void review(event);
          }}
          className="order-edit-form"
          noValidate
        >
          <fieldset
            className={`dialog-section order-edit-section${locked.has('address') ? ' order-edit-locked' : ''}`}
            disabled={locked.has('address')}
            data-testid={locked.has('address') ? 'order-edit-locked-address' : 'order-edit-address'}
          >
            <legend className="dialog-section__head">
              {locked.has('address') ? 'Shipping address · locked' : 'Shipping address'}
            </legend>
            <div className="form-field-row">
              <FormField name="firstName" label="First name">
                <Input {...form.register('firstName')} data-testid="order-edit-first-name" />
              </FormField>
              <FormField name="lastName" label="Last name">
                <Input {...form.register('lastName')} data-testid="order-edit-last-name" />
              </FormField>
            </div>
            <div className="form-field-row">
              <FormField
                name="address1"
                label="Street and number"
                error={errors.address1?.message}
                description={
                  values.address1.trim() !== initial.address1.trim() &&
                  edits?.address?.original?.address1 !== undefined
                    ? `Changed. ${channel} has ${edits.address.original.address1}.`
                    : undefined
                }
              >
                <Input {...form.register('address1')} data-testid="order-edit-street" />
              </FormField>
              <FormField name="address2" label="Apartment or second line">
                <Input {...form.register('address2')} data-testid="order-edit-address2" />
              </FormField>
            </div>
            <div className="form-field-row form-field-row--cols-3">
              <FormField name="postalCode" label="Postcode" error={errors.postalCode?.message}>
                <Input {...form.register('postalCode')} data-testid="order-edit-postcode" />
              </FormField>
              <FormField name="city" label="City" error={errors.city?.message}>
                <Input {...form.register('city')} data-testid="order-edit-city" />
              </FormField>
              <FormField name="country" label="Country" error={errors.country?.message}>
                <Input
                  {...form.register('country')}
                  maxLength={2}
                  data-testid="order-edit-country"
                />
              </FormField>
            </div>
          </fieldset>

          <fieldset
            className={`dialog-section order-edit-section${locked.has('delivery') ? ' order-edit-locked' : ''}`}
            disabled={locked.has('delivery')}
            data-testid={locked.has('delivery') ? 'order-edit-locked-delivery' : 'order-edit-delivery'}
          >
            <legend className="dialog-section__head">
              {locked.has('delivery') ? 'Delivery method · locked' : 'Delivery method'}
            </legend>
            <div className="form-field-row">
              <FormField
                name="methodId"
                label="Method id"
                error={errors.methodId?.message}
                description="The id carrier mapping rules match on. Decides which carrier OpenLinker buys the label from. Delivery is not repriced."
              >
                <Input {...form.register('methodId')} data-testid="order-edit-method-id" />
              </FormField>
              <FormField name="methodName" label="Method name (optional)">
                <Input {...form.register('methodName')} data-testid="order-edit-method-name" />
              </FormField>
            </div>
            <div className="form-field-row">
              <FormField
                name="pickupId"
                label="Pickup point code (optional)"
                error={errors.pickupId?.message}
                description="Leave empty for home delivery."
              >
                <Input {...form.register('pickupId')} data-testid="order-edit-pickup-id" />
              </FormField>
              <FormField name="pickupName" label="Pickup point name (optional)">
                <Input {...form.register('pickupName')} data-testid="order-edit-pickup-name" />
              </FormField>
            </div>
          </fieldset>

          <fieldset
            className={`dialog-section order-edit-section${locked.has('lines') ? ' order-edit-locked' : ''}`}
            disabled={locked.has('lines')}
            data-testid={locked.has('lines') ? 'order-edit-locked-lines' : 'order-edit-lines'}
          >
            <legend className="dialog-section__head">
              {locked.has('lines') ? 'Items · locked' : 'Items'}
            </legend>
            <div className="data-table__container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="order-edit-num">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lineMeta.map((meta, index) => (
                    <tr key={meta.orderLineId}>
                      <td>
                        <span className="order-line-item__product-info">
                          <span className="order-line-item__name">
                            {meta.name ?? meta.sku ?? meta.orderLineId}
                          </span>
                          {meta.sku ? (
                            <span className="order-line-item__sku mono-text">{meta.sku}</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="order-edit-num">
                        <span className="order-edit-inline order-edit-inline--end">
                          <Input
                            type="number"
                            min={0}
                            max={meta.maxQuantity}
                            step={1}
                            className="order-edit-qty"
                            aria-label={`Quantity, ${meta.name ?? meta.sku ?? meta.orderLineId}`}
                            invalid={Boolean(errors.lines?.[index]?.quantity)}
                            {...form.register(`lines.${index}.quantity`)}
                            data-testid="order-edit-line-quantity"
                          />
                          <span className="order-edit-was">
                            {meta.channelQuantity !== meta.maxQuantity
                              ? `of ${meta.maxQuantity} (${channel} has ${meta.channelQuantity})`
                              : `of ${meta.maxQuantity}`}
                          </span>
                        </span>
                        {errors.lines?.[index]?.quantity?.message ? (
                          <p className="form-field__error" role="alert">
                            {errors.lines[index]?.quantity?.message}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {linesRootError ? (
              <p className="form-field__error" role="alert" data-testid="order-edit-lines-error">
                {linesRootError}
              </p>
            ) : null}
            <p className="form-field__description">
              You can lower a quantity or set it to 0. Raising it or adding products would be a new
              sale. Ask the buyer to order again.
            </p>
          </fieldset>

          <fieldset
            className={`dialog-section order-edit-section${locked.has('discount') ? ' order-edit-locked' : ''}`}
            disabled={locked.has('discount')}
            data-testid={locked.has('discount') ? 'order-edit-locked-discount' : 'order-edit-discount'}
          >
            <legend className="dialog-section__head">
              {locked.has('discount') ? 'Discount · locked' : 'Discount'}
            </legend>
            <div className="form-field-row">
              <FormField name="discountValue" label="Discount" error={errors.discountValue?.message}>
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  {...form.register('discountValue')}
                  data-testid="order-edit-discount-amount"
                />
              </FormField>
              <FormField name="discountMode" label="As">
                <Select {...form.register('discountMode')} data-testid="order-edit-discount-mode">
                  <option value="amount">Amount, gross</option>
                  <option value="percent">Percent of the goods</option>
                </Select>
              </FormField>
            </div>
            <p className="form-field__description">
              {edits?.discount
                ? `This order has a discount of ${edits.discount.amount} ${edits.discount.currency}. A new one replaces it, and 0 removes it.`
                : 'Lowers the order total. One discount per order. OpenLinker doesn’t refund the buyer: you refund on the channel.'}
            </p>
          </fieldset>

          {needsAck ? (
            <Alert
              tone="warning"
              title="This order is on the pack bench"
              data-testid="order-edit-ack-alert"
            >
              Someone claimed this order at the pack bench and may already be picking it. Lowering a
              quantity changes their task underneath them.
              <label className="order-cancel-check">
                <input
                  type="checkbox"
                  data-testid="order-edit-ack"
                  {...form.register('acknowledgeAcceptedWork')}
                />
                <span>I have told the packer</span>
              </label>
            </Alert>
          ) : null}

          {ceiling ? (
            <Alert
              tone="warning"
              title="More than can still be refunded"
              data-testid="order-edit-ceiling-refusal"
            >
              {`The refund for this discount is ${ceiling.requested} ${ceiling.currency}, but only ${remainingRefundable(ceiling.ceiling, ceiling.alreadyRefunded)} ${ceiling.currency} can still be refunded on this order (${ceiling.alreadyRefunded} ${ceiling.currency} already refunded).`}
              <label className="order-cancel-check">
                <input
                  type="checkbox"
                  data-testid="order-edit-ceiling-ack"
                  {...form.register('acknowledgeAboveCeiling')}
                />
                <span>Keep the discount anyway and record the refund as it is</span>
              </label>
            </Alert>
          ) : null}

          <p className="order-edit-totals-note" data-testid="order-edit-paid-note">
            {paidOnChannel
              ? `The buyer paid ${formatAmount(paidOnChannel.amount, paidOnChannel.currency)} on ${channel}. The review shows the total after your changes.`
              : 'The review shows the total after your changes.'}
          </p>

          <div className="dialog__footer">
            <DialogClose asChild>
              <Button type="button" tone="secondary" data-testid="order-edit-cancel">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              tone="primary"
              disabled={reviewDisabled}
              data-testid="order-edit-review-button"
            >
              {busy === 'reviewing' ? 'Checking…' : 'Review changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A refusal about what was typed or an unexpected failure, not the order's state. */
function FailureAlert({ failure }: { failure: Failure }): ReactElement | null {
  const code = readOrderEditErrorCode(failure.error);
  // The soft gate and the ceiling render their own tick-boxes on the form.
  if (
    classifyOrderEditRefusal(code) === 'needs-ack' ||
    readRefundCeilingFigures(failure.error) !== null
  ) {
    return null;
  }
  return (
    <Alert
      tone="error"
      title={code ? ORDER_EDIT_REFUSAL_COPY[code].title : 'Could not save this edit'}
      data-testid="order-edit-error"
    >
      {readServerReason(failure.error, 'Could not save this edit.')}
    </Alert>
  );
}
