/**
 * Record Return Dialog (#3078/#3084)
 *
 * Opens an operator-authored return for a channel with no returns feed at
 * all (`POST /returns/record`) — the one write that addresses no EXISTING
 * return, so every field is the entire request rather than a correction to
 * one.
 *
 * **Single line, matching the reviewed mockup and every #3084 acceptance
 * criterion.** `RecordReturnDto.lines` is an array; this dialog wraps its one
 * set of fields into a one-element array at submit time
 * (`record-return-dialog.schema.ts`'s own docblock states why).
 *
 * **The order field is the same bounded free-text + `<datalist>` shape
 * `match-return-dialog.tsx` already ships**, for the identical reason: no
 * order-search endpoint exists, and an order carries no buyer name on the FE
 * contract at all.
 *
 * **The connection-mismatch warning is a step STRONGER than the reviewed
 * mockup's**, not a copy of it. The mockup compared a coarse `channel` string
 * because its fixtures had nothing else; this dialog compares the picked
 * order's own `sourceConnectionId` — the actual mapping ground truth — against
 * the picked connection, so the warning is authoritative rather than a
 * heuristic. It is still only a WARNING, never a block: a return legitimately
 * arriving via a different connection than the one that placed the order is
 * one of the documented orphan causes (#2332), so the operator may know
 * something this proactive check cannot.
 *
 * **Two refusals become field errors** (#3084's acceptance criterion):
 * 400 `unknown-order` on the order field, 400 `order-not-on-connection` on
 * the connection field. `no-lines` / `invalid-quantity` are handled
 * defensively (the form's own Zod validation should already have caught
 * them) and fall through to the generic message. Mapped through RHF's own
 * `form.setError`, not a parallel `useState` — the mechanism the framework
 * already offers for exactly this (tech-lead review on #3284, SUGGESTION).
 *
 * **`sku` is a required field here** (see `record-return-dialog.schema.ts`
 * for why), and the reason `<select>` renders `describeRefundReason` labels
 * rather than the raw wire vocabulary — the same labeller
 * `return-money-panel.tsx` already imports from the `orders` barrel for the
 * identical vocabulary (tech-lead review on #3284, IMPORTANT).
 *
 * **`note` is deliberately still not collected**, unlike `sku` above — issue
 * #3084's Proposed Solution names both, but `note` has no downstream
 * consequence the way an unrestockable line does, so it stays a follow-up
 * rather than blocking this PR (tech-lead review on #3284, SUGGESTION —
 * stated explicitly so the omission is a decision on the record).
 *
 * @module apps/web/src/features/returns/components
 */
import type { FormEvent, ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
// Cross-feature imports go through each feature's own barrel — the
// `match-return-dialog.tsx` / `return-money-panel.tsx` precedent.
import { useConnectionsQuery } from '../../connections';
import { describeRefundReason, useOrdersQuery } from '../../orders';
import { useRecordReturnMutation } from '../hooks/use-record-return-mutation';
import { RETURN_LINE_REASON_VALUES } from '../api/returns.types';
import { readRecordRefusalReason } from '../lib/record-error';
import { RECORD_RETURN_DIALOG_COPY as COPY } from '../lib/record-return-dialog.copy';
import {
  recordReturnDialogSchema,
  RECORD_RETURN_DIALOG_DEFAULT_VALUES,
  type RecordReturnDialogFormSubmission,
  type RecordReturnDialogFormValues,
} from './record-return-dialog.schema';

/** Recent orders offered as suggestions — the same bound `match-return-dialog.tsx` uses. */
const RECENT_ORDERS_LIMIT = 20;

const DATALIST_ID = 'record-return-order-suggestions';

interface RecordReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the return is recorded — the caller's cue to refresh its own view. */
  onRecorded?: () => void;
}

export function RecordReturnDialog({
  open,
  onOpenChange,
  onRecorded,
}: RecordReturnDialogProps): ReactElement {
  const ordersQuery = useOrdersQuery(undefined, { limit: RECENT_ORDERS_LIMIT });
  const orders = ordersQuery.data?.items ?? [];
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  // The connection SELECT is required and the ONLY way to satisfy it is to
  // pick a fetched option, so a failed read leaves the field unsatisfiable
  // with nothing on screen to explain why (tech-lead review on #3284,
  // IMPORTANT) — distinct from the orders `<datalist>`, where free text is
  // still honoured and a failed read degrades acceptably on its own.
  const connectionsUnavailable = connectionsQuery.isError;

  const mutation = useRecordReturnMutation();

  const form = useForm<RecordReturnDialogFormValues, undefined, RecordReturnDialogFormSubmission>({
    defaultValues: RECORD_RETURN_DIALOG_DEFAULT_VALUES,
    resolver: zodResolver(recordReturnDialogSchema),
  });

  const watchedOrderId = form.watch('internalOrderId');
  const watchedConnectionId = form.watch('sourceConnectionId');
  const pickedOrder = orders.find((order) => order.internalOrderId === watchedOrderId) ?? null;
  const pickedConnection = connections.find((connection) => connection.id === watchedConnectionId) ?? null;
  const orderConnection =
    pickedOrder !== null
      ? connections.find((connection) => connection.id === pickedOrder.sourceConnectionId) ?? null
      : null;
  const showConnectionMismatch =
    pickedOrder !== null &&
    pickedConnection !== null &&
    pickedOrder.sourceConnectionId !== pickedConnection.id;

  function resetAndClose(): void {
    form.reset(RECORD_RETURN_DIALOG_DEFAULT_VALUES);
    onOpenChange(false);
  }

  const onSubmit = form.handleSubmit((values) => {
    if (mutation.isPending) return;

    mutation.mutate(
      {
        internalOrderId: values.internalOrderId,
        sourceConnectionId: values.sourceConnectionId,
        lines: [
          {
            sku: values.sku,
            name: values.itemName,
            reason: values.reason,
            quantityAdvised: values.quantityAdvised,
          },
        ],
      },
      {
        onSuccess: () => {
          resetAndClose();
          onRecorded?.();
        },
        onError: (error) => {
          const reason = readRecordRefusalReason(error);
          if (reason === 'unknown-order') {
            form.setError('internalOrderId', { message: COPY.unknownOrder(values.internalOrderId) });
            return;
          }
          if (reason === 'order-not-on-connection') {
            form.setError('sourceConnectionId', { message: COPY.orderNotOnConnection });
            return;
          }
          // `no-lines` / `invalid-quantity` should already be unreachable past
          // this form's own Zod validation, and anything else (404, 5xx,
          // network) falls through to `mutation.error` below.
        },
      },
    );
  });

  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    void onSubmit(event);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) {
          if (!next) resetAndClose();
          else onOpenChange(next);
        }
      }}
    >
      <DialogContent>
        <DialogTitle>{COPY.title}</DialogTitle>
        <DialogDescription>{COPY.description}</DialogDescription>

        <form onSubmit={handleFormSubmit}>
          <FormField
            name="internalOrderId"
            label={COPY.orderFieldLabel}
            description={COPY.orderFieldDescription}
            error={form.formState.errors.internalOrderId?.message}
          >
            <Input
              placeholder={COPY.orderFieldPlaceholder}
              list={DATALIST_ID}
              // Chrome's own history-based autocomplete competes with the
              // intentional <datalist> suggestions and, inside a dialog, can
              // force the page to scroll to keep its popup visible — the
              // field appears to "run away" upward as the operator types.
              // `off` leaves the datalist as the only suggestion source (the
              // match-return-dialog.tsx precedent, #3082).
              autoComplete="off"
              {...form.register('internalOrderId')}
            />
          </FormField>
          <datalist id={DATALIST_ID}>
            {orders.map((order) => {
              const label = order.syncStatus[0]?.externalOrderNumber ?? order.internalOrderId;
              return (
                <option key={order.internalOrderId} value={order.internalOrderId}>
                  {label}
                </option>
              );
            })}
          </datalist>

          <FormField
            name="sourceConnectionId"
            label={COPY.connectionFieldLabel}
            description={COPY.connectionFieldDescription}
            error={form.formState.errors.sourceConnectionId?.message}
          >
            <Select disabled={connectionsQuery.isPending || connectionsUnavailable} {...form.register('sourceConnectionId')}>
              <option value="">
                {connectionsQuery.isPending ? COPY.connectionLoadingPlaceholder : COPY.connectionPlaceholder}
              </option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </Select>
          </FormField>

          {connectionsUnavailable ? <Alert tone="error">{COPY.connectionsLoadFailed}</Alert> : null}

          {showConnectionMismatch && orderConnection !== null ? (
            <Alert tone="warning">{COPY.connectionMismatchWarning(orderConnection.name)}</Alert>
          ) : null}

          <FormField
            name="sku"
            label={COPY.skuFieldLabel}
            description={COPY.skuFieldDescription}
            error={form.formState.errors.sku?.message}
          >
            <Input
              placeholder={COPY.skuFieldPlaceholder}
              autoComplete="off"
              {...form.register('sku')}
            />
          </FormField>

          <FormField
            name="itemName"
            label={COPY.itemFieldLabel}
            error={form.formState.errors.itemName?.message}
          >
            {/* Same reasoning as the order field above: a plain text input
                with no `autoComplete="off"` invites Chrome's own history
                dropdown, which can shift the dialog's layout as the operator
                types. This field has no <datalist> of its own, so the fix is
                the same one line. */}
            <Input
              placeholder={COPY.itemFieldPlaceholder}
              autoComplete="off"
              {...form.register('itemName')}
            />
          </FormField>

          <FormField
            name="reason"
            label={COPY.reasonFieldLabel}
            error={form.formState.errors.reason?.message}
          >
            <Select {...form.register('reason')}>
              <option value="">{COPY.reasonPlaceholder}</option>
              {RETURN_LINE_REASON_VALUES.map((reason) => (
                <option key={reason} value={reason}>
                  {describeRefundReason(reason)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            name="quantityAdvised"
            label={COPY.quantityFieldLabel}
            error={form.formState.errors.quantityAdvised?.message}
          >
            <Input type="number" min={1} {...form.register('quantityAdvised')} />
          </FormField>

          <Alert tone="info">{COPY.note}</Alert>

          {mutation.isError && readRecordRefusalReason(mutation.error) === null ? (
            <Alert tone="error">{COPY.genericError}</Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" tone="secondary" disabled={mutation.isPending} onClick={resetAndClose}>
              {COPY.cancel}
            </Button>
            <Button type="submit" disabled={mutation.isPending || connectionsUnavailable}>
              {mutation.isPending ? COPY.confirming : COPY.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
