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
import { IIdentifierMappingService } from './application/services/identifier-mapping.service.interface';

@Module({
  imports: [TypeOrmModule.forFeature([IdentifierMappingOrmEntity])],
  providers: [
    IdentifierMappingRepository,
    {
      provide: IIdentifierMappingService,
      useClass: IdentifierMappingService,
    },
    {
      provide: 'IdentifierMappingPort',
      useExisting: IIdentifierMappingService,
    },
  ],
  exports: [IIdentifierMappingService, 'IdentifierMappingPort'],
})
export class IdentifierMappingModule {}

