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
export * from './domain/ports/invoice-record-repository.port';
export * from './domain/exceptions/invoice-record-not-found.exception';
export * from './domain/exceptions/duplicate-invoice-record.exception';
export * from './invoicing.tokens';
export { InvoicingModule } from './invoicing.module';
