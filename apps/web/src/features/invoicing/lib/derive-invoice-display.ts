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
import { getMessages } from '../../../shared/i18n';
import {
  FailureCodeValues,
  type FailureCode,
  type InvoiceRecord,
  type RegulatoryStatus,
} from '../api/invoicing.types';
import type { InvoiceDisplayStatus } from '../components/invoice-status-badge';


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

/**
 * True for the two codes whose fix is on the CONNECTION, not the order: a
 * setting the adapter found missing before sending, or one the provider
 * refused. Both render the stored reason and a link to the connection.
 */
export function isConnectionSettingFailureCode(code: FailureCode | null | undefined): boolean {
  return code === 'connection-setup-incomplete' || code === 'connection-setting-rejected';
}

/**
 * Resolves a PII-free `failureCode` to localized operator copy. Falls back to a
 * generic in-doubt-safe message when the code is absent / unknown (the row is
 * then treated as in-doubt by `deriveInvoiceDisplayStatus`).
 */
export function resolveFailureCopy(invoice: InvoiceRecord): string {
  const copy = getMessages('invoicing').invoice.failureCode;
  const code = invoice.failureCode;
  // The codes whose stored reason is the adapter's own sentence naming the
  // setting to fix (#3772) - it says more than any fixed copy can, and it is
  // PII-free by the adapter's opt-in. Other codes keep their fixed copy.
  if (isConnectionSettingFailureCode(code) && invoice.failureReason) {
    return invoice.failureReason;
  }
  if (code && (FailureCodeValues as readonly string[]).includes(code)) {
    return copy[code];
  }
  return copy.unknown;
}
