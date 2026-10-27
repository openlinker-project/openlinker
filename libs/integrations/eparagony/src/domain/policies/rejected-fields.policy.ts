/**
 * Rejected field paths
 *
 * A vendor validation message (`message` on the error body, a string or a list
 * of strings) quotes the submitted document, so it can carry line names and
 * buyer identifiers and is never stored or logged. What an operator needs from
 * it is only WHICH field was refused. This extracts exactly that, and by
 * construction nothing else: a candidate path survives only when every named
 * segment is a property of OUR OWN request schema (`KNOWN_WIRE_FIELDS`, which
 * the vendor's contract defines and is public) and the rest is array indexes.
 * A buyer name or a line name cannot pass, because it is not a schema field -
 * an allowlist, not a scrub, so an unforeseen message shape yields no fields
 * rather than leaked data.
 *
 * @module libs/integrations/eparagony/src/domain/policies
 */

/** Property names of the vendor's `POST /documents` request contract. */
// Generic English words (name, number, value, ...) are left out: they would match
// ordinary message prose and report a field nobody named.
const KNOWN_WIRE_FIELDS: ReadonlySet<string> = new Set([
  'documentToken',
  'transactionToken',
  'eReceipt',
  'eInvoice',
  'eCorrectiveInvoice',
  'metadata',
  'correctedMetadata',
  'correctingMetadata',
  'lines',
  'correctedLines',
  'correctingLines',
  'correctionReason',
  'payments',
  'taxRates',
  'netValueByTaxRate',
  'taxValueByTaxRate',
  'merchantTIN',
  'merchantName',
  'merchantAddress',
  'merchantStoreId',
  'merchantDocumentId',
  'consumerName',
  'consumerAddress',
  'consumerTIN',
  'productOrServiceName',
  'unitPrice',
  'netUnitPrice',
  'totalLineValue',
  'netTotalLineValue',
  'taxRate',
  'taxValue',
  'grossSaleValue',
  'totalPaid',
  'paymentForm',
  'paymentName',
  'invoiceNumber',
  'invoiceDate',
  'invoiceType',
  'issueDate',
  'saleEndDate',
  'orderId',
  'orderTime',
  'referenceNumber',
  'ksefNumber',
  'vatCalculationMethod',
  'processingMode',
  'calculationValidation',
  'documentType',
  'unitOfMeasure',
  'EAN',
  'SKU',
  'postalCode',
]);

/** A dotted / indexed path candidate, e.g. `eCorrectiveInvoice.correctingLines[0].unitPrice`. */
const PATH_CANDIDATE = /[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d+\])|(?:\.\d+))*/g;

const MAX_FIELDS = 5;
const MAX_FIELD_LENGTH = 80;

function readMessages(body: unknown): string[] {
  if (body === null || typeof body !== 'object') {
    return [];
  }
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') {
    return [message];
  }
  if (Array.isArray(message)) {
    return message.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function isAllowlistedPath(candidate: string): boolean {
  const named = candidate.split(/[.[\]]+/).filter((segment) => segment !== '' && !/^\d+$/.test(segment));
  return named.length > 0 && named.every((segment) => KNOWN_WIRE_FIELDS.has(segment));
}

/**
 * Field paths a vendor error body names, de-duplicated, bounded, and limited to
 * allowlisted schema fields. Returns `[]` for any body it cannot read.
 */
export function extractRejectedFields(body: unknown): string[] {
  const found: string[] = [];
  for (const message of readMessages(body)) {
    for (const match of message.matchAll(PATH_CANDIDATE)) {
      const candidate = match[0];
      if (
        candidate.length <= MAX_FIELD_LENGTH &&
        isAllowlistedPath(candidate) &&
        !found.includes(candidate)
      ) {
        found.push(candidate);
        if (found.length >= MAX_FIELDS) {
          return found;
        }
      }
    }
  }
  return found;
}
