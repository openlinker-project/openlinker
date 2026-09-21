/**
 * Match Return Dialog (#3078/#3082)
 *
 * The operator's way out of the orphan bucket: attribute a return to an
 * order. **Attribution is monotonic — there is no unmatch** (returns spec
 * §5, `ReturnMatchRefusedError`'s own docblock), so this dialog carries an
 * explicit "this can't be undone" warning rather than treating the write as
 * routine.
 *
 * **No order-search endpoint exists**, and an order carries no buyer name on
 * the FE contract at all (a deliberate PII boundary — see `OrderRecord` in
 * `features/orders/api/orders.types.ts`). So the field is a free-text input
 * for the internal order id, backed by a `<datalist>` of the 20 most recent
 * orders — the exact bounded, client-side-filtered shape
 * `command-palette-provider.tsx` already ships for the identical reason
 * (`ordersQuery` there is also `{ limit: 20 }`, unfiltered, with no backend
 * `search` param to lean on). Picking a suggestion fills the input with a
 * KNOWN-VALID id; typing free text is still honoured, and is what makes the
 * 400 `unknown-order` path in this file reachable rather than theoretical.
 *
 * **Two refusals, two renderings, matching the acceptance criteria exactly.**
 * 400 `unknown-order` is a FIELD error naming the typed value — the fix is in
 * the request, so it belongs beside the input the operator can correct.
 * 409 `already-attributed` is a DISTINCT message, not the generic error: it
 * is not a retryable failure, it is news that the return is already
 * resolved. Anything else (a 404, a 5xx, a network failure) falls through to
 * the generic sentence, mirroring `decline-error.ts`'s fallback discipline.
 *
 * **The confirm-time warning has something to point at.** The `<datalist>`
 * writes the raw internal id into the field's `value` and shows the
 * human-readable order number only as suggestion TEXT, which the browser
 * discards once a suggestion is picked — so at the moment "double-check the
 * order before confirming" matters most, nothing readable was left on
 * screen (tech-lead review on #3281, IMPORTANT). When the typed value
 * matches a fetched order exactly, the resolved order's own number is
 * echoed beneath the field, sourced from data already loaded for the
 * `<datalist>` rather than a second read.
 *
 * **The confirm affordance carries its own `writeAccess` lock** (tech-lead
 * review on #3281, IMPORTANT) — resolved by the page via
 * `useWriteAccess('orders:write', demoMode)`, the same shape
 * `ReturnDeclineAction` / `ReturnCustodyPanel` take, rather than relying on
 * whatever mounts this dialog to gate it. A parent-side-only lock would leave
 * a demo viewer able to open the dialog and find its primary button live.
 *
 * @module apps/web/src/features/returns/components
 */
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { isUnmappedApiError } from '../../../shared/api/api-error';
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
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
// Cross-feature import goes through the orders barrel — the same route
// `return-money-panel.tsx` already takes into `../../orders` (#337/#359).
import { useOrdersQuery } from '../../orders';
import { useMatchReturnToOrderMutation } from '../hooks/use-match-return-to-order-mutation';
import { readMatchRefusalReason } from '../lib/match-error';
import { MATCH_RETURN_DIALOG_COPY as COPY } from '../lib/match-return-dialog.copy';

/** Recent orders offered as suggestions, matching the command-palette bound. */
const RECENT_ORDERS_LIMIT = 20;

const DATALIST_ID = 'match-return-order-suggestions';

interface MatchReturnDialogProps {
  returnId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the return is confirmed attributed — including a lost race. */
  onMatched?: () => void;
  /**
   * Resolved by the page and passed in, exactly as `ReturnDeclineAction` /
   * `ReturnCustodyPanel` take it — one `useWriteAccess('orders:write',
   * demoMode)` per page, so every write surface on that screen agrees about
   * the session.
   */
  writeAccess: { canWrite: boolean; demoReadOnly: boolean; visible: boolean };
}

export function MatchReturnDialog({
  returnId,
  open,
  onOpenChange,
  onMatched,
  writeAccess,
}: MatchReturnDialogProps): ReactElement {
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  // A DISTINCT rendering from the mutation's own `isError` — a lost race is a
  // 409 the operator did not cause and cannot retry away, so it is shown as
  // news rather than left for `mutation.error` to render as a field error.
  const [alreadyAttributed, setAlreadyAttributed] = useState(false);

  const ordersQuery = useOrdersQuery(undefined, { limit: RECENT_ORDERS_LIMIT });
  const orders = ordersQuery.data?.items ?? [];

  const mutation = useMatchReturnToOrderMutation(returnId);

  // Exact match only — a partial or case-mismatched id is exactly the typo
  // the 400 `unknown-order` path exists to catch, so echoing a "resolved"
  // order for it would be misleading rather than reassuring.
  const trimmedValue = value.trim();
  const resolvedOrder = useMemo(
    () => orders.find((order) => order.internalOrderId === trimmedValue) ?? null,
    [orders, trimmedValue],
  );

  function resetAndClose(): void {
    setValue('');
    setFieldError(undefined);
    setAlreadyAttributed(false);
    // Local state alone isn't enough — the mutation object itself outlives a
    // close/reopen (the parent controls `open`, and this hook is called at
    // the top level rather than inside `DialogContent`), so a leftover
    // `mutation.error` from a prior generic failure would re-render the
    // Alert on a dialog the operator hasn't touched yet (tech-lead review
    // on #3281, IMPORTANT).
    mutation.reset();
    onOpenChange(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mutation.isPending || !writeAccess.canWrite) return;

    const trimmed = value.trim();
    if (trimmed === '') {
      setFieldError(COPY.fieldRequired);
      return;
    }
    setFieldError(undefined);

    mutation.mutate(
      { internalOrderId: trimmed },
      {
        onSuccess: () => {
          resetAndClose();
          onMatched?.();
        },
        onError: (error) => {
          const reason = readMatchRefusalReason(error);
          if (reason === 'unknown-order') {
            setFieldError(COPY.unknownOrder(trimmed));
            return;
          }
          if (reason === 'already-attributed') {
            // The return IS attributed by the time this renders — a re-read
            // is what the mutation's own `onSettled` triggers; this dialog's
            // job is only to say so and let the operator move on.
            setAlreadyAttributed(true);
            onMatched?.();
          }
          // Anything else falls through to `mutation.error` below, rendered
          // via the generic sentence.
        },
      },
    );
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
        {alreadyAttributed ? (
          <>
            <DialogTitle>{COPY.alreadyAttributedTitle}</DialogTitle>
            <DialogDescription>{COPY.alreadyAttributedBody}</DialogDescription>
            <DialogFooter>
              <Button onClick={resetAndClose}>{COPY.alreadyAttributedAcknowledge}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogTitle>{COPY.title}</DialogTitle>
            <DialogDescription>{COPY.description}</DialogDescription>

            <form onSubmit={handleSubmit}>
              <FormField
                name="internalOrderId"
                label={COPY.fieldLabel}
                description={COPY.fieldDescription}
                error={fieldError}
              >
                <Input
                  value={value}
                  placeholder={COPY.fieldPlaceholder}
                  list={DATALIST_ID}
                  // Chrome's own history-based autocomplete competes with the
                  // intentional <datalist> suggestions and, inside a dialog,
                  // can force the page to scroll to keep its popup visible —
                  // the field appears to "run away" upward as the operator
                  // types. `off` leaves the datalist as the only suggestion
                  // source.
                  autoComplete="off"
                  onChange={(event) => {
                    setValue(event.target.value);
                    if (fieldError !== undefined) setFieldError(undefined);
                  }}
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

              {resolvedOrder !== null ? (
                <p className="text-muted match-return-dialog__resolved-order">
                  {COPY.resolvedOrder(
                    resolvedOrder.syncStatus[0]?.externalOrderNumber ?? resolvedOrder.internalOrderId,
                  )}
                </p>
              ) : null}

              <Alert tone="warning">{COPY.warning}</Alert>

              {mutation.error && isUnmappedApiError(mutation.error, (e) => readMatchRefusalReason(e) !== null) ? (
                <Alert tone="error">{COPY.genericError}</Alert>
              ) : null}

              <DialogFooter>
                <Button type="button" tone="secondary" disabled={mutation.isPending} onClick={resetAndClose}>
                  {COPY.cancel}
                </Button>
                <ReadOnlyLock active={writeAccess.demoReadOnly} message={COPY.readOnly}>
                  <Button
                    type="submit"
                    disabled={mutation.isPending || !writeAccess.canWrite}
                  >
                    {mutation.isPending ? COPY.confirming : COPY.confirm}
                  </Button>
                </ReadOnlyLock>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
