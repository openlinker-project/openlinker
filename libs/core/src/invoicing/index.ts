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
export {
  InvoiceTriggerModelValues,
  parseTriggerModel,
} from './domain/types/invoice-trigger.types';
export type { InvoiceTriggerModel } from './domain/types/invoice-trigger.types';
export * from './domain/entities/buyer-profile.entity';
export * from './domain/entities/invoice-record.entity';
export * from './domain/ports/invoicing.port';
export * from './domain/ports/capabilities/regulatory-status-reader.capability';
export * from './domain/ports/capabilities/regulatory-transmitter.capability';
export * from './domain/ports/invoice-record-repository.port';
export type { RegulatoryStatusReader } from './domain/ports/capabilities/regulatory-status-reader.capability';
export { isRegulatoryStatusReader } from './domain/ports/capabilities/regulatory-status-reader.capability';
export * from './domain/exceptions/invoice-record-not-found.exception';
export * from './domain/exceptions/duplicate-invoice-record.exception';
export { BatchedTriggerNotImplementedError } from './domain/exceptions/batched-trigger-not-implemented.error';
export { InvalidBuyerProfileError } from './application/mappers/errors/invalid-buyer-profile.error';
export { UnsupportedPriceTreatmentError } from './application/mappers/errors/unsupported-price-treatment.error';
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
export * from './invoicing.tokens';
export { InvoicingModule } from './invoicing.module';
