/**
 * Fiscalization Bounded Context - Public Surface
 *
 * Exports the neutral capability contract, its sub-capability and guard, the
 * registration record, the repository port, domain exceptions, the command
 * composer, the application service and the NestJS module.
 *
 * Country- and vendor-agnostic by design (ADR-042): no regime-specific concept
 * crosses this barrel. ORM entities are infrastructure detail and live on the
 * `@openlinker/core/fiscalization/orm-entities` sub-barrel instead (#594).
 *
 * @module libs/core/src/fiscalization
 */
export * from './domain/types/fiscalization.types';
export * from './domain/entities/fiscal-registration-record.entity';
export * from './domain/ports/fiscalization.port';
// Re-exports both `FiscalRegistrationLocator` and `isFiscalRegistrationLocator`.
export * from './domain/ports/capabilities/fiscal-registration-locator.capability';
export * from './domain/ports/fiscal-registration-record-repository.port';
export * from './domain/exceptions/duplicate-fiscal-registration-record.exception';
export * from './domain/exceptions/fiscal-registration-record-not-found.exception';
export * from './domain/exceptions/fiscal-registration-not-in-doubt.exception';
export * from './domain/exceptions/missing-idempotency-key.exception';
export * from './domain/exceptions/order-already-registered.exception';
export * from './domain/exceptions/order-already-has-invoice.exception';
export * from './domain/exceptions/fiscal-registration-contended.exception';
export { InvalidFiscalLineError } from './application/mappers/errors/invalid-fiscal-line.error';
export { UnsupportedFiscalPriceTreatmentError } from './application/mappers/errors/unsupported-fiscal-price-treatment.error';
export {
  toRegisterTransactionCommand,
  OrderToRegisterTransactionCommandInput,
} from './application/mappers/order-to-register-transaction-command.mapper';
export type {
  IFiscalRegistrationService,
  FiscalReconcileResult,
} from './application/services/fiscal-registration.service.interface';
export { FiscalRegistrationService } from './application/services/fiscal-registration.service';
export * from './fiscalization.tokens';
export { FiscalizationModule } from './fiscalization.module';
