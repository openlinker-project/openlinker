/**
 * Identifier Mapping Module Exports
 *
 * Public API exports for the identifier mapping module. Exports domain entities,
 * ports, types, services, and the NestJS module.
 *
 * @module libs/core/src/identifier-mapping
 */
export * from './domain/entities/identifier-mapping.entity';
export * from './domain/entities/connection.entity';
export * from './domain/ports/identifier-mapping.port';
export * from './domain/ports/identifier-mapping-repository.port';
export * from './domain/ports/connection.port';
export * from './domain/types/identifier-mapping.types';
export * from './domain/types/connection.types';
export * from './domain/exceptions/duplicate-identifier-mapping.error';
export * from './domain/exceptions/mapping-already-exists.error';
export { ConnectionNotFoundException } from './domain/exceptions/connection-not-found.exception';
export { ConnectionDisabledException } from './domain/exceptions/connection-disabled.exception';
export { IdentifierMappingConflictException } from './domain/exceptions/identifier-mapping-conflict.exception';
export * from './application/services/identifier-mapping.service.interface';
export * from './application/services/identifier-mapping.service';
export * from './identifier-mapping.tokens';
export * from './identifier-mapping.module';

// ORM entities are exposed on the host-only `@openlinker/core/identifier-mapping/orm-entities`
// sub-path (#594). Plugins must not import them from here.

