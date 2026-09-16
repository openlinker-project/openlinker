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
 * @module apps/web/src/features/returns/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
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
}

export function MatchReturnDialog({
  returnId,
  open,
  onOpenChange,
  onMatched,
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

  function resetAndClose(): void {
    setValue('');
    setFieldError(undefined);
    setAlreadyAttributed(false);
    onOpenChange(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mutation.isPending) return;

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

              <Alert tone="warning">{COPY.warning}</Alert>

              {mutation.isError && readMatchRefusalReason(mutation.error) === null ? (
                <Alert tone="error">{COPY.genericError}</Alert>
              ) : null}

              <DialogFooter>
                <Button type="button" tone="secondary" disabled={mutation.isPending} onClick={resetAndClose}>
                  {COPY.cancel}
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? COPY.confirming : COPY.confirm}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
