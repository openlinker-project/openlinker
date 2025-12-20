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
export * from './application/services/identifier-mapping.service.interface';
export * from './application/services/identifier-mapping.service';
export * from './identifier-mapping.tokens';
export * from './identifier-mapping.module';

