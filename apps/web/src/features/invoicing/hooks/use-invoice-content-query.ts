/**
 * useInvoiceContentQuery (#2076)
 *
 * Fetches an invoice's issued-document content snapshot
 * (`GET /invoices/:invoiceId/content`) so the correction flow can let an
 * operator **pick** the line to correct instead of typing its position blind.
 *
 * Why this is the right source for the picker: the returned `lines` are
 * index-aligned with the server-side `issuedLineSnapshot` that
 * `CorrectionLineInput.originalLineNumber` (1-based) addresses. Both are built
 * from the same array in the same `InvoiceService` call — issuance passes
 * `cmd.lines` to `buildContent` and snapshots the same array; correction passes
 * `correctedLines` to both. `buildContent` is a 1:1 order-preserving `map`.
 * Picking from this list therefore yields the position the adapter will index.
 *
 * **A 409 is an expected, terminal outcome — not an error to retry.** The
 * invoice carries no content snapshot: still pending, issued by an adapter that
 * captured none, or a row predating the column. `contentUnavailable` reports
 * that so the picker can degrade to manual entry rather than block a
 * correction; retrying would be pointless load and would leave the flow
 * spinning on a state that will never change.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { IssuedDocumentContent } from '../api/invoicing.types';

/** True when the failure means "this invoice has no content snapshot", not "the request failed". */
export function isContentUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

export interface InvoiceContentQueryResult {
  query: UseQueryResult<IssuedDocumentContent>;
  /**
   * The invoice has no content snapshot (409) — a stable fact, not a transient
   * failure. The picker falls back to manual entry and says so.
   */
  contentUnavailable: boolean;
  /**
   * The read failed for some OTHER reason (500, network). Distinct from
   * `contentUnavailable` because the operator can retry this one, and telling
   * them "this invoice has no line list" would be a false statement about their
   * data.
   */
  fetchFailed: boolean;
  /**
   * Lines are present AND a correction will index exactly them. False when the
   * server reports `linesIndexedByCorrection: false` (an invoice issued before
   * the snapshot column, where a correction rebuilds from the order instead) —
   * in that case picking a position would address an array the server never
   * sees, so the picker must not offer one.
   */
  linesAreAuthoritative: boolean;
}

export function useInvoiceContentQuery(invoiceId: string): InvoiceContentQueryResult {
  const apiClient = useApiClient();

  const query = useQuery<IssuedDocumentContent>({
    queryKey: invoicingQueryKeys.content(invoiceId),
    enabled: Boolean(invoiceId),
    queryFn: () => apiClient.invoicing.getContent(invoiceId),
    // Never retry a 409 — it is a stable fact about the invoice, and retrying
    // spends load to learn the same thing. A transient failure (500, network)
    // IS worth one retry: the fallback it otherwise lands on tells the operator
    // something false about their invoice. The app-wide default is `retry:
    // false`, so this predicate is load-bearing, not decorative.
    retry: (failureCount, error) => !isContentUnavailable(error) && failureCount < 1,
  });

  const contentUnavailable = isContentUnavailable(query.error);
  return {
    query,
    contentUnavailable,
    fetchFailed: query.isError && !contentUnavailable,
    linesAreAuthoritative: query.data?.linesIndexedByCorrection === true,
  };
}
