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
import { ConnectionOrmEntity } from './infrastructure/persistence/entities/connection.orm-entity';
import { IdentifierMappingRepository } from './infrastructure/persistence/repositories/identifier-mapping.repository';
import { ConnectionRepository } from './infrastructure/persistence/repositories/connection.repository';
import { IdentifierMappingService } from './application/services/identifier-mapping.service';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IDENTIFIER_MAPPING_PORT_TOKEN,
  IDENTIFIER_MAPPING_REPOSITORY_TOKEN,
  CONNECTION_PORT_TOKEN,
} from './identifier-mapping.tokens';

// Re-export tokens for convenience
export {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IDENTIFIER_MAPPING_PORT_TOKEN,
  IDENTIFIER_MAPPING_REPOSITORY_TOKEN,
  CONNECTION_PORT_TOKEN,
} from './identifier-mapping.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([IdentifierMappingOrmEntity, ConnectionOrmEntity]),
  ],
  providers: [
    // Provide classes directly first
    IdentifierMappingRepository,
    ConnectionRepository,
    IdentifierMappingService,
    // Then provide token bindings using useExisting
    {
      provide: IDENTIFIER_MAPPING_REPOSITORY_TOKEN,
      useExisting: IdentifierMappingRepository,
    },
    {
      provide: IDENTIFIER_MAPPING_SERVICE_TOKEN,
      useExisting: IdentifierMappingService,
    },
    {
      provide: IDENTIFIER_MAPPING_PORT_TOKEN,
      useExisting: IdentifierMappingService,
    },
    {
      provide: CONNECTION_PORT_TOKEN,
      useExisting: ConnectionRepository,
    },
    {
      provide: 'ConnectionPort',
      useExisting: CONNECTION_PORT_TOKEN,
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
    {
      provide: 'IdentifierMappingRepositoryPort',
      useExisting: IDENTIFIER_MAPPING_REPOSITORY_TOKEN,
    },
  ],
  exports: [
    IDENTIFIER_MAPPING_SERVICE_TOKEN,
    IDENTIFIER_MAPPING_PORT_TOKEN,
    IDENTIFIER_MAPPING_REPOSITORY_TOKEN,
    CONNECTION_PORT_TOKEN,
    'IIdentifierMappingService',
    'IdentifierMappingPort',
    'IdentifierMappingRepositoryPort',
    'ConnectionPort',
  ],
})
export class IdentifierMappingModule {}

