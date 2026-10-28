/**
 * Fiscal Provider Failure Details
 *
 * The PII-free identifiers of a provider's refusal, carried as STRUCTURED fields
 * so an operator can look a failure up or quote it to the provider's support
 * (#3843). Before this, the vendor's code and its document id existed only in
 * the INTERNAL `errorMessage`, which is never returned to an API caller because
 * other paths can echo buyer data into it - so an operator saw one fixed
 * sentence for every cause.
 *
 * The adapter declares the fields on its throwable; core reads them
 * STRUCTURALLY, never value-importing an adapter error type and never parsing a
 * message. {@link readFiscalProviderFailureDetails} is the one gate they pass
 * through, and it is strict on purpose: a value is kept only when it has the
 * SHAPE of an identifier, so a field an adapter fills by mistake with free text
 * is dropped rather than shown.
 *
 * @module libs/core/src/fiscalization/domain/types
 */

/** Identifiers of one provider refusal. Every field is optional and PII-free. */
export interface FiscalProviderFailureDetails {
  /** The provider's own error code, digits only (eparagony.pl: `83`). */
  errorCode: string | null;
  /** The fiscal device's own error code, digits only; device-model specific. */
  deviceErrorCode: string | null;
  /** The provider's identifier for the attempt (eparagony.pl: the document token). */
  documentId: string | null;
  /**
   * An operator-facing explanation the ADAPTER composed from fixed text, for a
   * provider answer it recognised exactly. Never the provider's own wording.
   */
  hint: string | null;
}

/** Codes are numbers; ten digits is far past any vendor code seen so far. */
const CODE_PATTERN = /^\d{1,10}$/;
/** A token or reference: letters, digits, `-`, `_`, `.`, `/`. No spaces, no text. */
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
/** Matches `MAX_FAILURE_REASON_LENGTH`: the hint is a sibling of that sentence. */
export const MAX_FISCAL_FAILURE_HINT_LENGTH = 200;

/**
 * The neutral shape read off a caught adapter throwable. NOT an adapter error
 * subclass - see the file header.
 */
interface FiscalProviderFailureDetailsCarrier {
  providerErrorCode?: unknown;
  providerDeviceErrorCode?: unknown;
  providerDocumentId?: unknown;
  providerErrorHint?: unknown;
}

function readCode(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  return typeof text === 'string' && CODE_PATTERN.test(text.trim()) ? text.trim() : null;
}

function readDocumentId(value: unknown): string | null {
  return typeof value === 'string' && DOCUMENT_ID_PATTERN.test(value.trim())
    ? value.trim()
    : null;
}

function readHint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, MAX_FISCAL_FAILURE_HINT_LENGTH) : null;
}

/**
 * Read the identifiers an adapter declared on a thrown error. Returns `null`
 * when it declared none, so a record that carries no details stays distinct
 * from one whose details are all empty - the frontend renders nothing for
 * `null` rather than an empty block.
 */
export function readFiscalProviderFailureDetails(
  error: unknown,
): FiscalProviderFailureDetails | null {
  if (error === null || typeof error !== 'object') return null;
  const carrier = error as FiscalProviderFailureDetailsCarrier;
  const details: FiscalProviderFailureDetails = {
    errorCode: readCode(carrier.providerErrorCode),
    deviceErrorCode: readCode(carrier.providerDeviceErrorCode),
    documentId: readDocumentId(carrier.providerDocumentId),
    hint: readHint(carrier.providerErrorHint),
  };
  return Object.values(details).some((value) => value !== null) ? details : null;
}
