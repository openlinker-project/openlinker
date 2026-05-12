/**
 * Customers Module Exports
 *
 * Public API exports for the customers module. Exports domain entities,
 * ports, types, services, and the NestJS module.
 *
 * @module libs/core/src/customers
 */
export * from './domain/entities/customer-projection.entity';
export * from './domain/entities/customer-address-projection.entity';
export * from './domain/entities/destination-address-mapping.entity';
export * from './domain/ports/customer-identity-resolver.port';
export * from './domain/ports/customer-projection-repository.port';
export * from './domain/types/customer-identity.types';
export * from './domain/types/customer-projection.types';
export * from './domain/exceptions/customer-projection.exception';
export * from './application/interfaces/customer-identity-resolver.service.interface';
export * from './application/services/customer-identity-resolver.service';
export * from './application/interfaces/customer-projection.service.interface';
export * from './application/services/customer-projection.service';
export * from './application/interfaces/order-customer-projection-updater.service.interface';
export * from './application/services/order-customer-projection-updater.service';
export * from './customers.tokens';
export * from './customers.module';

// Customers-context ORM entities have no external consumer today; the TypeORM
// CLI discovers them via the `**/*.orm-entity.{ts,js}` glob in
// `apps/api/src/database/data-source.ts`. If a future host or integration test
// fixture needs them, add a `customers/orm-entities.ts` sub-barrel (#594).
