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

/** Binding token for the {@link IInvoiceService} application service (ADR-026 "SVC"). */
export const INVOICE_SERVICE_TOKEN = Symbol('IInvoiceService');

/**
 * Binding token for the {@link IAutoIssueTriggerService} core policy service
 * (ADR-026 §3, OL #1120). Injected by `OrderIngestionService` to turn a
 * qualifying transition into per-connection issuance jobs.
 */
export const AUTO_ISSUE_TRIGGER_SERVICE_TOKEN = Symbol('IAutoIssueTriggerService');

/**
 * Binding token for the {@link IRegulatoryStatusReconciliationService} (#1121).
 * Refreshes `InvoiceRecord.regulatoryStatus` / `clearanceReference` for issued,
 * non-terminal records via the `RegulatoryStatusReader` sub-capability.
 */
export const REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN = Symbol(
  'IRegulatoryStatusReconciliationService',
);

/**
 * Binding token for the {@link IPaymentStatusRefreshService} (#1354). Refreshes
 * `InvoiceRecord.paymentStatus` for a single document via the
 * `PaymentStatusReader` sub-capability when a provider payment webhook triggers.
 */
export const PAYMENT_STATUS_REFRESH_SERVICE_TOKEN = Symbol('IPaymentStatusRefreshService');
