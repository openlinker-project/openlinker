/**
 * Invoice Failure Classification
 *
 * Turns a throwable caught at the invoicing adapter boundary into the neutral
 * triple every surface reads: {@link InvoiceFailureMode} (may it be retried?),
 * {@link InvoiceFailureCode} (what kind of problem is it?) and a PII-free,
 * operator-facing `failureReason`.
 *
 * One function, two callers, by design (#3772): `InvoiceService` persists the
 * triple on the record, and the HTTP controller answers the failed request with
 * the same code. Re-deriving the classification at the interface would let the
 * response and the stored record disagree about one failure.
 *
 * Pure, framework-free, and STRUCTURAL: the adapter error is read duck-typed
 * and never value-imported, so core stays free of any integration package.
 *
 * @module domain/domain-services
 */
import {
  CURRENCY_REJECTION_MARKERS,
  SALE_CLASSIFICATION_REJECTION_MARKERS,
  type InvoiceFailureCode,
  type InvoiceFailureMode,
} from '../types/invoicing.types';

/**
 * Max persisted length of the PII-free `failureReason` (W1). Far shorter than
 * `errorMessage` because it is a sanitized, operator-facing one-liner that is
 * SAFE to expose on the response DTO - it must never become a PII sink.
 */
export const MAX_FAILURE_REASON_LENGTH = 200;

/**
 * Substrings (case-insensitive) that mark a `rejected` failure as a buyer
 * tax-identifier problem, so the FE can prompt the operator to fix the buyer
 * data. Neutral vocabulary only (no country tax-system names per ADR-026):
 * matches the generic "tax id" the adapter surfaces in its rejection reason.
 */
const TAX_ID_REJECTION_MARKERS = ['tax id', 'tax-id', 'taxid', 'tax identifier'] as const;

/**
 * The value an adapter stamps on `failureCause` to say "this refusal is about
 * the connection's own configuration" (#3772). See {@link InvoiceFailureCarrier}.
 */
export const CONNECTION_SETUP_FAILURE_CAUSE = 'connection-setup';

/**
 * Neutral shape read STRUCTURALLY off a caught adapter throwable (#1200) - it is
 * NOT an adapter error subclass and is NOT value-imported. Anything that cannot
 * be read as the terminal `'rejected'` is treated as the fiscal-safe
 * `'in-doubt'`.
 */
export interface InvoiceFailureCarrier {
  failureMode?: unknown;
  /**
   * Operator-readable rejection reason some adapters stamp on a TERMINAL
   * `rejected` throwable (e.g. Subiekt's `SubiektInvoiceRejectedError.reason`).
   */
  reason?: unknown;
  /**
   * Opt-in, per throw (#3772): `'connection-setup'` declares that the refusal
   * happened BEFORE the provider was contacted because the connection is
   * missing a setting, and that `reason` is composed from connection
   * configuration only - never from order or buyer data. That promise is what
   * lets this one code expose the adapter's own sentence as `failureReason`;
   * every other code keeps a fixed constant.
   *
   * REVIEW BAR: this is the single place where a PII guarantee rests on adapter
   * discipline rather than on construction - core cannot verify that a sentence
   * came from connection config and not from an order. So every new throw that
   * sets `failureCause: 'connection-setup'` is a reviewable event: check that
   * its `reason` interpolates `Connection.config` values only (never buyer,
   * order or provider-response data). `MAX_FAILURE_REASON_LENGTH` bounds the
   * damage of a mistake, not the mistake.
   *
   * A field rather than another marker list, deliberately: the marker lists
   * classify by what a message happens to say, which is right for a provider's
   * words OpenLinker does not author, and wrong for a refusal the adapter
   * authors itself and can simply declare.
   */
  failureCause?: unknown;
}

export interface InvoiceFailureClassification {
  failureMode: InvoiceFailureMode;
  failureCode: InvoiceFailureCode;
  failureReason: string;
}

const FAILURE_REASONS: Record<InvoiceFailureCode, string> = {
  'buyer-tax-id-invalid': 'The buyer tax identifier was rejected as invalid.',
  // Worded to fit an adapter PRE-CALL refusal, which is the only origin
  // that actually reaches this code today (see InvoiceFailureCode's doc):
  // it never claims the provider saw a request it did not. It stays
  // accurate for a provider-side currency rejection too, should one ever
  // route here, which is why it names the condition rather than the actor.
  'invalid-currency':
    'The settlement currency is missing, malformed, or not accepted for this document. Fix the currency on the order and re-issue.',
  // Names the connection config field an operator can actually set - the
  // generic 'provider-rejected' copy gives no clue this is a one-field
  // config gap rather than a per-order problem (#3031).
  'sale-classification-required':
    "This connection requires a sale classification (goods vs. services) to be configured before it can issue invoices. Set the connection's `defaultSaleType` and re-issue.",
  // The fallback only: an adapter that opts in supplies its own sentence
  // naming the missing setting (#3772).
  'connection-setup-incomplete':
    "This connection is missing a setting it needs to issue invoices. Complete the connection's settings and re-issue.",
  'provider-rejected': 'The invoicing provider rejected the request.',
  'transport-timeout':
    'The invoicing request timed out; the document may or may not have been created.',
  'provider-error': 'The invoicing provider returned an unexpected error.',
};

function bound(text: string): string {
  return text.length <= MAX_FAILURE_REASON_LENGTH ? text : text.slice(0, MAX_FAILURE_REASON_LENGTH);
}

/**
 * Fiscal-safe default: ONLY an explicit, recognised `'rejected'` is treated as a
 * terminal no-document failure (safe to re-attempt). EVERYTHING else - an
 * absent/unknown/`'in-doubt'` marker, a plain `Error`, a non-error throwable -
 * collapses to `'in-doubt'`, which the read-gate will NOT auto-re-attempt. An
 * unclassifiable failure must never be assumed safe to re-issue.
 */
export function classifyInvoiceFailureMode(error: unknown): InvoiceFailureMode {
  const mode = (error as InvoiceFailureCarrier | null)?.failureMode;
  return mode === 'rejected' ? 'rejected' : 'in-doubt';
}

function readReason(error: unknown): string {
  const carrier = error as InvoiceFailureCarrier | null;
  if (typeof carrier?.reason === 'string') return carrier.reason;
  return error instanceof Error ? error.message : '';
}

/**
 * Derive the neutral code from the mode plus a STRUCTURAL read of the
 * throwable:
 *
 *   - `in-doubt` -> `transport-timeout`.
 *   - `rejected` with `failureCause: 'connection-setup'` -> `connection-setup-incomplete`
 *     (checked first: it is a declaration, not an inference from wording).
 *   - `rejected`, else by the `reason`/message text: a tax-identifier
 *     rejection -> `buyer-tax-id-invalid`; a settlement-currency rejection ->
 *     `invalid-currency`; a missing sale classification ->
 *     `sale-classification-required`; anything else -> `provider-rejected`.
 *
 * Tax id is checked before currency purely for determinism - a message naming
 * both is routed to the buyer-data fix, which is the more specific remedy.
 */
export function classifyInvoiceFailureCode(
  error: unknown,
  failureMode: InvoiceFailureMode
): InvoiceFailureCode {
  if (failureMode === 'in-doubt') {
    return 'transport-timeout';
  }
  if ((error as InvoiceFailureCarrier | null)?.failureCause === CONNECTION_SETUP_FAILURE_CAUSE) {
    return 'connection-setup-incomplete';
  }
  const haystack = readReason(error).toLowerCase();
  if (TAX_ID_REJECTION_MARKERS.some((marker) => haystack.includes(marker))) {
    return 'buyer-tax-id-invalid';
  }
  if (CURRENCY_REJECTION_MARKERS.some((marker) => haystack.includes(marker))) {
    return 'invalid-currency';
  }
  if (SALE_CLASSIFICATION_REJECTION_MARKERS.some((marker) => haystack.includes(marker))) {
    return 'sale-classification-required';
  }
  return 'provider-rejected';
}

/**
 * The PII-free, operator-facing sentence for a code. A fixed constant per code,
 * so it can never echo provider or buyer data - with ONE exception: for
 * `connection-setup-incomplete` it is the adapter's own `reason`, which the
 * adapter vouched for by opting in (see {@link InvoiceFailureCarrier.failureCause}).
 * Bounded either way, for defence in depth.
 */
export function deriveInvoiceFailureReason(
  failureCode: InvoiceFailureCode,
  error?: unknown
): string {
  if (failureCode === 'connection-setup-incomplete') {
    const reason = (error as InvoiceFailureCarrier | null)?.reason;
    if (typeof reason === 'string' && reason.trim().length > 0) {
      return bound(reason.trim());
    }
  }
  return bound(FAILURE_REASONS[failureCode]);
}

export function classifyInvoiceFailure(error: unknown): InvoiceFailureClassification {
  const failureMode = classifyInvoiceFailureMode(error);
  const failureCode = classifyInvoiceFailureCode(error, failureMode);
  return {
    failureMode,
    failureCode,
    failureReason: deriveInvoiceFailureReason(failureCode, error),
  };
}
