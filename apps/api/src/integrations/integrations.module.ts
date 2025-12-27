/**
 * Integrations API Module
 *
 * NestJS module for integrations API endpoints. Imports core integrations
 * module and identifier mapping module, registers controllers and services
 * for connection management and adapter discovery.
 *
 * @module apps/api/src/integrations
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { ConnectionController } from './http/connection.controller';
import { AdapterController } from './http/adapter.controller';
import { ConnectionService } from './application/services/connection.service';

@Module({
  imports: [CoreIntegrationsModule, IdentifierMappingModule],
  controllers: [ConnectionController, AdapterController],
  providers: [ConnectionService],
})
export class IntegrationsModule {}

