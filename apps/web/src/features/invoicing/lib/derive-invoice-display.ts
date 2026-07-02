/**
 * Invoice display derivation + fiscal-safety gates (#1240)
 *
 * Single source of truth for the locked fiscal-safety rules the redesign
 * enforces across the panel, list, and detail page. Centralized so the rules
 * are verifiable in one place rather than re-derived per surface:
 *
 *   - A `failed` row splits into `failed·rejected` (Retry-safe — nothing was
 *     issued) vs `in-doubt` (a document MAY exist on the provider; a blind
 *     Retry risks a DUPLICATE). An absent / unknown `failureMode` is treated as
 *     `in-doubt` (fiscal-safe default).
 *   - Retry is offered ONLY when `failureMode === 'rejected'`.
 *   - `issuing` is a locked, in-flight live-lease state: NO action.
 *   - Terminal clearance success is `accepted`, never `cleared`.
 *
 * Failure copy is keyed off the PII-free `failureCode` (W1 #1214) → localized
 * strings; the raw provider message is never surfaced (the DTO omits it).
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type { FailureCode, InvoiceRecord, RegulatoryStatus } from '../api/invoicing.types';
import type { InvoiceDisplayStatus } from '../components/invoice-status-badge';

type Translate = (key: string, fallback: string) => string;

export type RegCardTone = 'reg-card--info' | 'reg-card--success' | 'reg-card--error' | '';

/**
 * Severity-stripe tone for the shared `.reg-card` treatment (#1282). Shared
 * by every per-provider `invoiceDetailSection` slot (KSeF, Subiekt, inFakt)
 * so the status→tone mapping lives in exactly one place.
 */
export function regCardToneFor(status: RegulatoryStatus): RegCardTone {
  if (status === 'submitted') return 'reg-card--info';
  if (status === 'accepted') return 'reg-card--success';
  if (status === 'rejected') return 'reg-card--error';
  return '';
}

/**
 * Maps an `InvoiceRecord | null` (null = invoice-absent) to the FE display
 * status. A `failed` row is split into `failed` (rejected) vs `in-doubt` off
 * `failureMode` — any non-`rejected` mode (including absent / unknown) is
 * `in-doubt` (fiscal-safe default).
 */
export function deriveInvoiceDisplayStatus(
  invoice: InvoiceRecord | null,
): InvoiceDisplayStatus {
  if (!invoice) {
    return 'not-issued';
  }
  if (invoice.status === 'failed') {
    return invoice.failureMode === 'rejected' ? 'failed' : 'in-doubt';
  }
  return invoice.status;
}

/**
 * Fiscal-safety Retry gate. Retry is safe ONLY for a `failed` row whose
 * `failureMode` is `rejected` — nothing was issued. `in-doubt`, `issuing`,
 * `pending`, `issued`, and the invoice-absent state never expose a one-click
 * Retry. (The not-issued case has its own Issue affordance, not Retry.)
 */
export function canRetryInvoice(invoice: InvoiceRecord | null): boolean {
  return invoice?.status === 'failed' && invoice.failureMode === 'rejected';
}

const FAILURE_CODE_FALLBACK: Record<FailureCode, string> = {
  'buyer-tax-id-invalid':
    'The provider rejected the buyer’s tax ID. Check the tax ID on the order’s customer, then retry. Nothing was issued.',
  'provider-rejected':
    'The provider rejected the document. Check the order’s data, then retry. Nothing was issued.',
  'transport-timeout':
    'The request to the provider timed out, so a document may already exist there. Check the provider before re-issuing — a blind retry could create a duplicate.',
  'provider-error':
    'The provider returned an error. Check the order’s data, then retry. Nothing was issued.',
};

/**
 * Resolves a PII-free `failureCode` to localized operator copy. Falls back to a
 * generic in-doubt-safe message when the code is absent / unknown (the row is
 * then treated as in-doubt by `deriveInvoiceDisplayStatus`).
 */
export function resolveFailureCopy(invoice: InvoiceRecord, t: Translate): string {
  const code = invoice.failureCode;
  if (code && code in FAILURE_CODE_FALLBACK) {
    return t(`invoice.failureCode.${code}`, FAILURE_CODE_FALLBACK[code]);
  }
  return t(
    'invoice.failureCode.unknown',
    'We couldn’t confirm whether this invoice was issued. Check the provider before re-issuing — a blind retry could create a duplicate.',
  );
}
