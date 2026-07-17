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

/** Binding token for the {@link InvoiceNumberingSeriesRepositoryPort} (#1575). */
export const INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN = Symbol(
  'InvoiceNumberingSeriesRepositoryPort',
);

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

/** Binding token for the {@link InvoiceNumberGapNoteRepositoryPort} (#8). */
export const INVOICE_NUMBER_GAP_NOTE_REPOSITORY_TOKEN = Symbol(
  'InvoiceNumberGapNoteRepositoryPort',
);

/** Binding token for the {@link INumberingAuditService} gap-audit read model (#8). */
export const NUMBERING_AUDIT_SERVICE_TOKEN = Symbol('INumberingAuditService');

/**
 * Binding token for the {@link INumberingSeriesService} application service (#9/#10).
 * The API layer injects this instead of the repository port directly, keeping the
 * cross-context contract to an `I*Service` seam (pattern validation + periodKey
 * seeding live behind it, never in the controller).
 */
export const NUMBERING_SERIES_SERVICE_TOKEN = Symbol('INumberingSeriesService');

/**
 * Binding token for the `IOfflineResubmissionService` (#1700, mini-epic #1585).
 * The degraded-mode sweep that resubmits `pending-submission` documents via the
 * {@link OfflineResubmitter} sub-capability. Implementation lands in a later part
 * of the epic; the token is declared here so the barrel exposes it now.
 */
export const OFFLINE_RESUBMISSION_SERVICE_TOKEN = Symbol('IOfflineResubmissionService');

/**
 * Binding token for the `IPendingRecoveryService` (#1700, mini-epic #1585). The
 * crash-recovery sweep that reconciles interrupted submits, falling back to the
 * {@link RegulatoryRecordLocator} authority lookup. Implementation lands in a
 * later part of the epic; the token is declared here so the barrel exposes it now.
 */
export const PENDING_RECOVERY_SERVICE_TOKEN = Symbol('IPendingRecoveryService');
