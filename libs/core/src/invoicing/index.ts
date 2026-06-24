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
export * from './domain/entities/buyer-profile.entity';
export * from './domain/entities/invoice-record.entity';
export * from './domain/ports/invoicing.port';
export * from './domain/ports/capabilities/regulatory-status-reader.capability';
export * from './domain/ports/capabilities/regulatory-transmitter.capability';
export * from './domain/ports/invoice-record-repository.port';
export * from './domain/exceptions/invoice-record-not-found.exception';
export * from './domain/exceptions/duplicate-invoice-record.exception';
export { IInvoiceService } from './application/services/invoice.service.interface';
export { InvoiceService } from './application/services/invoice.service';
// Order -> command composer (#1118) + its PII-clean pre-issue errors, surfaced
// so the #1119 HTTP controller can compose the command server-side and map
// these to 400 (#1119).
export {
  toIssueInvoiceCommand,
  OrderToIssueInvoiceCommandInput,
} from './application/mappers/order-to-issue-invoice-command.mapper';
export { InvalidBuyerProfileError } from './application/mappers/errors/invalid-buyer-profile.error';
export { UnsupportedPriceTreatmentError } from './application/mappers/errors/unsupported-price-treatment.error';
export * from './invoicing.tokens';
export { InvoicingModule } from './invoicing.module';
