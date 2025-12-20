/**
 * Identifier Mapping Module
 *
 * NestJS module for identifier mapping functionality. Configures TypeORM
 * entities, repositories, and services. Exports the identifier mapping
 * service and port for use in other modules.
 *
 * @module libs/core/src/identifier-mapping
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentifierMappingOrmEntity } from './infrastructure/persistence/entities/identifier-mapping.orm-entity';
import { IdentifierMappingRepository } from './infrastructure/persistence/repositories/identifier-mapping.repository';
import { IdentifierMappingService } from './application/services/identifier-mapping.service';

// Token for dependency injection (interfaces can't be used as values)
export const IDENTIFIER_MAPPING_SERVICE_TOKEN = Symbol('IIdentifierMappingService');
export const IDENTIFIER_MAPPING_PORT_TOKEN = Symbol('IdentifierMappingPort');

@Module({
  imports: [TypeOrmModule.forFeature([IdentifierMappingOrmEntity])],
  providers: [
    IdentifierMappingRepository,
    {
      provide: IDENTIFIER_MAPPING_SERVICE_TOKEN,
      useClass: IdentifierMappingService,
    },
    {
      provide: IDENTIFIER_MAPPING_PORT_TOKEN,
      useExisting: IDENTIFIER_MAPPING_SERVICE_TOKEN,
    },
    // Also provide as string tokens for convenience
    {
      provide: 'IIdentifierMappingService',
      useExisting: IDENTIFIER_MAPPING_SERVICE_TOKEN,
    },
    {
      provide: 'IdentifierMappingPort',
      useExisting: IDENTIFIER_MAPPING_SERVICE_TOKEN,
    },
  ],
  exports: [
    IDENTIFIER_MAPPING_SERVICE_TOKEN,
    IDENTIFIER_MAPPING_PORT_TOKEN,
    'IIdentifierMappingService',
    'IdentifierMappingPort',
  ],
})
export class IdentifierMappingModule {}

