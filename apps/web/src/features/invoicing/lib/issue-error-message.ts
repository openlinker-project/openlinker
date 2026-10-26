/**
 * resolveIssueErrorMessage (#757)
 *
 * Pure mapper from a `POST /invoices` failure to an operator-friendly toast
 * string. Discriminators pinned to the verified HTTP shapes (plan §2.6):
 *
 *   1. Capability-disabled (HTTP 400, `details.error` is
 *      `CapabilityNotEnabledException` / `CapabilityNotSupportedException`) →
 *      a FIXED string. MUST NOT echo `error.message` (it embeds the internal
 *      `connectionId` + `adapterKey`).
 *   2. Sanitised provider rejection (HTTP 422) → surface `error.message`
 *      verbatim (controller correlationId string, PII-clean).
 *   3. Other HTTP 400 (buyer-profile / price-treatment) → surface
 *      `error.message` (PII-clean mapper text, operator-actionable).
 *   4. Insufficient permissions (HTTP 403) → a FIXED, permission-specific
 *      string (#1613). The FE gates the Issue/Retry affordances behind
 *      `invoices:write` (`useWriteAccess`), so this is normally a defensive
 *      fallback for a stale session — never echo `error.message`.
 *   5. Defensive 409 → already-issued fixed string.
 *   6. Fallback → generic fixed string.
 *
 * Security invariant: only branches 2 and 3 surface `error.message`; the
 * capability branch, the 403 branch, and the fallback emit FIXED strings.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import type { CapabilityErrorBody } from '../api/invoicing.types';

type Translate = (key: string, fallback: string) => string;

const CAPABILITY_EXCEPTION_NAMES = new Set([
  'CapabilityNotEnabledException',
  'CapabilityNotSupportedException',
]);

/** Discriminates a capability-disabled 400 from a legitimate buyer-profile 400
 *  by the structured body's `error` name (NOT status alone). */
export function isCapabilityDisabledError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) {
    return false;
  }
  const body = error.details as CapabilityErrorBody | null;
  return Boolean(body?.error && CAPABILITY_EXCEPTION_NAMES.has(body.error));
}

/**
 * True for the issue endpoint's answer to an adapter refusal about the
 * connection's own configuration (#3772): a 422 whose body names
 * `connection-setup-incomplete`. The panel answers it in place - an alert
 * linking to the connection's settings - rather than with a toast, the same
 * treatment {@link isMissingNumberingSeriesError} gets.
 */
export function isConnectionSetupIncompleteError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 422) {
    return false;
  }
  const body = error.details as { error?: unknown; failureCode?: unknown } | null;
  return body?.error === 'InvoiceIssueRejected' && body.failureCode === 'connection-setup-incomplete';
}

/**
 * A refusal the operator may overrule (DEF-23/26/30/31): the server read the
 * sale as one it would not issue by default and named the code to send back
 * in `acknowledgeWarnings` to go ahead anyway. Two shapes carry it - a 422
 * `acknowledgement-required` from the provider adapter, and a 409
 * `OrderNotIssuable` for a cancelled or refunded order. `message` is the
 * server's own PII-free sentence, written to be shown as is.
 */
export interface AcknowledgementRequest {
  warningCode: string;
  message: string;
}

export function readAcknowledgementRequest(error: unknown): AcknowledgementRequest | null {
  if (!(error instanceof ApiError) || (error.status !== 422 && error.status !== 409)) {
    return null;
  }
  const body = error.details as
    | { error?: unknown; failureCode?: unknown; warningCode?: unknown; failureReason?: unknown }
    | null;
  if (typeof body?.warningCode !== 'string' || body.warningCode === '') {
    return null;
  }
  const overrulable =
    (error.status === 422 && body.failureCode === 'acknowledgement-required') ||
    (error.status === 409 && body.error === 'OrderNotIssuable');
  if (!overrulable) {
    return null;
  }
  const message = typeof body.failureReason === 'string' ? body.failureReason : error.message;
  return { warningCode: body.warningCode, message };
}

/**
 * True for either 422 whose fix is on the connection rather than the order:
 * `connection-setup-incomplete` (nothing was sent) or
 * `connection-setting-rejected` (the provider refused a connection setting,
 * e.g. a seller tax number it does not have registered). The panel answers
 * both in place with an alert linking to the connection's settings.
 */
export function isConnectionSettingError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 422) {
    return false;
  }
  const body = error.details as { error?: unknown; failureCode?: unknown } | null;
  return (
    body?.error === 'InvoiceIssueRejected' &&
    (body.failureCode === 'connection-setup-incomplete' ||
      body.failureCode === 'connection-setting-rejected')
  );
}

/**
 * Discriminates the "no numbering series configured" 400 (AC #6). The invoicing
 * controller maps `MissingNumberingSeriesException` to a 400 carrying
 * `{ error: 'MissingNumberingSeriesException' }`, so an issue-without-series
 * rejection can be surfaced as an actionable CTA (link to the numbering page)
 * instead of a bare toast. Name-based, not status alone.
 */
export function isMissingNumberingSeriesError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) {
    return false;
  }
  const body = error.details as CapabilityErrorBody | null;
  return body?.error === 'MissingNumberingSeriesException';
}

export function resolveIssueErrorMessage(error: unknown, t: Translate): string {
  // Branch order matters: the capability-disabled 400 (fixed copy, no PII echo)
  // MUST be tested before the generic 400 branch that surfaces `error.message`.
  if (isCapabilityDisabledError(error)) {
    return t('invoice.error.capabilityDisabled', 'Invoicing is not enabled for this connection.');
  }
  if (error instanceof ApiError) {
    // Branches 2 + 3 (the ONLY two that echo the server message): a sanitised
    // provider rejection (422, controller correlationId string) and a
    // non-capability buyer-profile/price-treatment 400 (PII-clean mapper text).
    // The capability-disabled 400 is already handled above (fixed copy, no echo),
    // so reaching this with status 400 means a non-capability 400. SECURITY: this
    // assumes every non-capability 400 message is server-sanitised — the
    // discriminator is name-based, so an unmodeled 400 shape would echo whatever
    // the BE sent. Keep this in lockstep with the controller's 400 vocabulary.
    if (error.status === 422 || error.status === 400) {
      return error.message;
    }
    if (error.status === 403) {
      return t(
        'invoice.error.forbidden',
        "You don't have permission to issue invoices - this action requires an administrator account.",
      );
    }
    if (error.status === 409) {
      return t('invoice.error.alreadyIssued', 'This order already has an issued invoice.');
    }
  }
  return t('invoice.error.generic', 'Could not issue the invoice. Please try again.');
}
