/**
 * Invoicing Bounded Context — Public Surface
 *
 * Exports domain types/entities/exceptions/ports, the repository token, and the
 * NestJS module. Country-agnostic by design (ADR-026) — no country/regulatory
 * concept crosses this barrel. ORM entities are infrastructure detail and are
 * deliberately NOT exported (no cross-context consumer needs them yet, #594).
 *
 * @module libs/core/src/invoicing
 */
export * from './domain/types/invoicing.types';
export * from './domain/types/invoice-numbering.types';
export * from './domain/types/numbering-audit.types';
export {
  renderInvoiceNumber,
  validateNumberingPattern,
  assertValidNumberingPattern,
  assertDocumentNumberWithinLength,
  computePeriodKey,
} from './domain/numbering/invoice-number-pattern';
export {
  InvoiceTriggerModelValues,
  parseTriggerModel,
} from './domain/types/invoice-trigger.types';
export type { InvoiceTriggerModel } from './domain/types/invoice-trigger.types';
export { normalizeShippingLineName } from './domain/types/shipping-line-label.types';
export * from './domain/entities/buyer-profile.entity';
export * from './domain/entities/invoice-record.entity';
export * from './domain/entities/invoice-numbering-series.entity';
export * from './domain/ports/invoicing.port';
// Re-exports both `DocumentNumberConsumer` and `isDocumentNumberConsumer` (#1575).
export * from './domain/ports/capabilities/document-number-consumer.capability';
// Re-exports both `RegulatoryStatusReader` and `isRegulatoryStatusReader`.
export * from './domain/ports/capabilities/regulatory-status-reader.capability';
// Re-exports both `PaymentStatusReader` and `isPaymentStatusReader` (#1354).
export * from './domain/ports/capabilities/payment-status-reader.capability';
// Re-exports both `PaymentMarker` and `isPaymentMarker` (#1362).
export * from './domain/ports/capabilities/payment-marker.capability';
export * from './domain/ports/capabilities/regulatory-transmitter.capability';
export * from './domain/ports/capabilities/regulatory-resubmitter.capability';
// Re-exports both `OfflineResubmitter` and `isOfflineResubmitter` (#1700).
export * from './domain/ports/capabilities/offline-resubmitter.capability';
// Re-exports both `RegulatoryRecordLocator` and `isRegulatoryRecordLocator` (#1700).
export * from './domain/ports/capabilities/regulatory-record-locator.capability';
export * from './domain/ports/capabilities/correction-issuer.capability';
export * from './domain/ports/capabilities/regulatory-document-reader.capability';
export * from './domain/ports/capabilities/bank-accounts-reader.capability';
export * from './domain/ports/capabilities/bank-account-default-setter.capability';
export * from './domain/ports/capabilities/invoice-email-sender.capability';
export * from './domain/ports/invoice-record-repository.port';
export * from './domain/ports/invoice-numbering-series-repository.port';
export * from './domain/ports/invoice-number-gap-note-repository.port';
export * from './domain/exceptions/invoice-record-not-found.exception';
export * from './domain/exceptions/duplicate-invoice-record.exception';
export * from './domain/exceptions/missing-numbering-series.exception';
export * from './domain/exceptions/duplicate-document-number.exception';
export * from './domain/exceptions/document-number-too-long.exception';
export * from './domain/exceptions/invalid-numbering-pattern.exception';
export * from './domain/exceptions/invoice-numbering-series-not-found.exception';
export * from './domain/exceptions/numbering-gap-note-reason-required.exception';
export * from './domain/exceptions/source-document-immutable.error';
export { BatchedTriggerNotImplementedError } from './domain/exceptions/batched-trigger-not-implemented.error';
export { InvalidBuyerProfileError } from './application/mappers/errors/invalid-buyer-profile.error';
export { InvalidInvoiceLineError } from './application/mappers/errors/invalid-invoice-line.error';
export { UnsupportedPriceTreatmentError } from './application/mappers/errors/unsupported-price-treatment.error';
export * from './domain/exceptions/unsupported-regulatory-document-kind.error';
export {
  toIssueInvoiceCommand,
  OrderToIssueInvoiceCommandInput,
} from './application/mappers/order-to-issue-invoice-command.mapper';
export { IInvoiceService } from './application/services/invoice.service.interface';
export { InvoiceService } from './application/services/invoice.service';
export type { IAutoIssueTriggerService } from './application/services/auto-issue-trigger.service.interface';
export {
  AutoIssueTriggerService,
  AUTO_ISSUE_RETRY_BUDGET,
} from './application/services/auto-issue-trigger.service';
export type {
  IRegulatoryStatusReconciliationService,
  RegulatoryStatusReconcileOptions,
  RegulatoryStatusReconcileResult,
} from './application/services/regulatory-status-reconciliation.service.interface';
export { RegulatoryStatusReconciliationService } from './application/services/regulatory-status-reconciliation.service';
export type {
  IOfflineResubmissionService,
  OfflineResubmissionOptions,
  OfflineResubmissionResult,
} from './application/services/offline-resubmission.service.interface';
export { OfflineResubmissionService } from './application/services/offline-resubmission.service';
export type {
  IPaymentStatusRefreshService,
  PaymentStatusRefreshOutcome,
  PaymentStatusRefreshResult,
} from './application/services/payment-status-refresh.service.interface';
export { PaymentStatusRefreshOutcomeValues } from './application/services/payment-status-refresh.service.interface';
export { PaymentStatusRefreshService } from './application/services/payment-status-refresh.service';
export type { INumberingAuditService } from './application/services/numbering-audit.service.interface';
export { NumberingAuditService } from './application/services/numbering-audit.service';
export type { INumberingSeriesService } from './application/services/numbering-series.service.interface';
export { NumberingSeriesService } from './application/services/numbering-series.service';
export * from './invoicing.tokens';
export { InvoicingModule } from './invoicing.module';
