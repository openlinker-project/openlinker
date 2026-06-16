/**
 * Invoicing Module Dependency Injection Tokens
 *
 * Symbol tokens for the invoicing bounded context. The `InvoicingPort` itself
 * is capability-resolved per-connection (no fixed token); only the repository
 * port needs a binding token.
 *
 * @module libs/core/src/invoicing
 */
export const INVOICE_RECORD_REPOSITORY_TOKEN = Symbol('InvoiceRecordRepositoryPort');
