/**
 * Waiting for the document a sale produced on a Subiekt connection.
 *
 * Extracted from `order-to-documents.spec.ts` when a second spec needed the
 * same wait (#3365). Duplicating it would have duplicated the reasoning in its
 * body, which is tuned against a live bridge rather than guessed - and two
 * copies of a tuned wait drift the moment one of them is corrected.
 *
 * @module apps/e2e/src/support
 */
import type { ApiClient } from '../api/api-client';
import type { InvoiceRecord } from '../api/api.types';

/** Poll for the order's document on ONE connection; `null` when none appears. */
export async function waitForDocument(
  api: ApiClient,
  internalOrderId: string,
  connectionId: string,
  timeoutMs: number,
): Promise<InvoiceRecord | null> {
  const deadline = Date.now() + timeoutMs;
  // Waits for a TERMINAL status, listed positively rather than by excluding the
  // in-flight ones (#3365 audit). `InvoiceStatusValues` is
  // `pending | issuing | issued | failed`, and this used to exclude `pending`
  // alone - so it returned an `issuing` row, which is OpenLinker mid-call
  // across the provider boundary, and the caller failed it as "not issued".
  // Measured against the live bridge: the document that produced that failure
  // was `PA 34/2026`, issued ten seconds later.
  const terminal = new Set(['issued', 'failed']);
  let last: InvoiceRecord | null = null;
  while (Date.now() < deadline) {
    try {
      const record = await api.invoices.getForOrder(internalOrderId, connectionId);
      if (record) {
        last = record;
        if (terminal.has(record.status)) return record;
      }
    } catch {
      // 404 until the gate fires - an expected state, not a failure.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  // The last non-terminal row rather than null, so a caller can say WHICH state
  // it was stuck in instead of reporting "no document" about one that exists.
  return last;
}
