/**
 * KSeF provider-invoice-id codec
 *
 * KSeF status/UPO reads require BOTH the session reference (returned by
 * `POST /sessions/online`) and the per-invoice reference (returned by
 * `POST /sessions/online/{ref}/invoices`) — the status path is
 * `GET /sessions/{sessionRef}/invoices/{invoiceRef}`. Core persists a single
 * opaque `providerInvoiceId` on the `InvoiceRecord`, so the adapter packs both
 * references into that one field and unpacks them when it later polls status.
 *
 * The encoding is adapter-private: core treats `providerInvoiceId` as an opaque
 * string and never parses it. The delimiter is `:`, which never appears in a
 * KSeF reference number (they are `[0-9A-Z-]`-only).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */

/** Delimiter between the session ref and the invoice ref. KSeF refs never contain it. */
const PROVIDER_INVOICE_ID_DELIMITER = ':';

/** Pack the session + invoice references into the opaque core `providerInvoiceId`. */
export function encodeProviderInvoiceId(sessionRef: string, invoiceRef: string): string {
  return `${sessionRef}${PROVIDER_INVOICE_ID_DELIMITER}${invoiceRef}`;
}

/**
 * Unpack a `providerInvoiceId` back into its session + invoice references.
 * Returns `null` if the value is not in the `{sessionRef}:{invoiceRef}` shape
 * (e.g. a legacy record persisted before this encoding) so callers can decide
 * how to degrade rather than crashing on a malformed split.
 */
export function decodeProviderInvoiceId(
  providerInvoiceId: string,
): { sessionRef: string; invoiceRef: string } | null {
  const delimiterIndex = providerInvoiceId.indexOf(PROVIDER_INVOICE_ID_DELIMITER);
  if (delimiterIndex <= 0 || delimiterIndex >= providerInvoiceId.length - 1) {
    return null;
  }
  return {
    sessionRef: providerInvoiceId.slice(0, delimiterIndex),
    invoiceRef: providerInvoiceId.slice(delimiterIndex + 1),
  };
}
