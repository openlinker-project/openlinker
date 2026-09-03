/**
 * Return custody mutations (#2380)
 *
 * The three per-line custody writes: receive, dispose and the not-returned
 * write-off.
 *
 * **Invalidation, never a cache seed**, for the reason
 * `use-decline-return-mutation` states: a write's response describes the LINE it
 * moved, while the page renders the aggregate — the derived stage (#2377), the
 * rollup counters and the return's own custody position all move with it, and
 * none of them is in the response. Seeding from the result would have to invent
 * them.
 *
 * The list is invalidated by PREFIX because its keys carry filters and
 * pagination, and because a custody write moves the segment counts (#2378) — a
 * received line can leave `needs_receiving` and enter `needs_disposition` in one
 * act, so a stale strip would send the operator back to work already done.
 *
 * All three live in one module because they share that invalidation contract
 * exactly; splitting them into three files with the same body is how one of
 * them eventually forgets a key.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type {
  AttestReturnLineStockInput,
  ConfirmReturnRefundInput,
  ConfirmReturnRefundResult,
  AttestReturnLineStockResult,
  DisposeReturnLineInput,
  DisposeReturnLineResult,
  MarkReturnLineNotReturnedInput,
  MarkReturnLineNotReturnedResult,
  ReceiveReturnLineInput,
  ReceiveReturnLineResult,
} from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/** What every custody mutation takes: which line, and the act's own fields. */
interface LineScoped<Input> {
  lineId: string;
  input: Input;
}

function useCustodyInvalidation(returnId: string): () => Promise<void> {
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(returnId) });
    await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
  };
}

export function useReceiveReturnLineMutation(
  returnId: string,
): UseMutationResult<ReceiveReturnLineResult, Error, LineScoped<ReceiveReturnLineInput>> {
  const apiClient = useApiClient();
  const invalidate = useCustodyInvalidation(returnId);

  return useMutation<ReceiveReturnLineResult, Error, LineScoped<ReceiveReturnLineInput>>({
    mutationFn: ({ lineId, input }) => apiClient.returns.receiveLine(returnId, lineId, input),
    // `onSettled`: a refusal is answered from persisted state the page may not
    // be showing (an over-receipt means somebody else already recorded units),
    // so re-reading on failure is what shows the operator why.
    onSettled: invalidate,
  });
}

export function useDisposeReturnLineMutation(
  returnId: string,
): UseMutationResult<DisposeReturnLineResult, Error, LineScoped<DisposeReturnLineInput>> {
  const apiClient = useApiClient();
  const invalidate = useCustodyInvalidation(returnId);

  return useMutation<DisposeReturnLineResult, Error, LineScoped<DisposeReturnLineInput>>({
    mutationFn: ({ lineId, input }) => apiClient.returns.disposeLine(returnId, lineId, input),
    onSettled: invalidate,
  });
}

/**
 * The § 5.4 attestation — *"Mark stock handled manually"* (#2381).
 *
 * It shares the invalidation contract exactly, which is why it belongs in this
 * module rather than a file of its own: attesting clears the line's
 * `restock_blocked` membership, so the #2378 segment counts and the row badge
 * both move with it.
 */
export function useMarkStockHandledMutation(
  returnId: string,
): UseMutationResult<AttestReturnLineStockResult, Error, LineScoped<AttestReturnLineStockInput>> {
  const apiClient = useApiClient();
  const invalidate = useCustodyInvalidation(returnId);

  return useMutation<AttestReturnLineStockResult, Error, LineScoped<AttestReturnLineStockInput>>({
    mutationFn: ({ lineId, input }) =>
      apiClient.returns.markStockHandled(returnId, lineId, input),
    onSettled: invalidate,
  });
}

export function useMarkReturnLineNotReturnedMutation(
  returnId: string,
): UseMutationResult<
  MarkReturnLineNotReturnedResult,
  Error,
  LineScoped<MarkReturnLineNotReturnedInput>
> {
  const apiClient = useApiClient();
  const invalidate = useCustodyInvalidation(returnId);

  return useMutation<
    MarkReturnLineNotReturnedResult,
    Error,
    LineScoped<MarkReturnLineNotReturnedInput>
  >({
    mutationFn: ({ lineId, input }) =>
      apiClient.returns.markLineNotReturned(returnId, lineId, input),
    onSettled: invalidate,
  });
}

/**
 * Record that the operator refunded the buyer (#2382, spec § 5.7).
 *
 * Return-scoped rather than line-scoped, unlike its neighbours — a refund is one
 * act against the return, and the service claims whichever lines it covers.
 *
 * It shares the invalidation contract exactly, which is why it lives here: the
 * money rail moves, and so do the #2378 segment counts (`money_pending` empties
 * as the claim settles).
 */
export function useConfirmReturnRefundMutation(
  returnId: string,
): UseMutationResult<ConfirmReturnRefundResult, Error, ConfirmReturnRefundInput> {
  const apiClient = useApiClient();
  const invalidate = useCustodyInvalidation(returnId);

  return useMutation<ConfirmReturnRefundResult, Error, ConfirmReturnRefundInput>({
    mutationFn: (input) => apiClient.returns.confirmRefund(returnId, input),
    onSettled: invalidate,
  });
}
