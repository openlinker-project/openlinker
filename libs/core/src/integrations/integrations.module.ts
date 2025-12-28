/**
 * Integrations Module
 *
 * NestJS module for integrations functionality. Configures adapter registry,
 * integrations service, and dependency injection. Exports services and ports
 * for use in other modules (API, Worker).
 *
 * @module libs/core/src/integrations
 */
import { Module } from '@nestjs/common';
import { IdentifierMappingModule } from '../identifier-mapping/identifier-mapping.module';
import { AdapterRegistryService } from './infrastructure/adapters/adapter-registry.service';
import { IntegrationsService } from './application/services/integrations.service';
import {
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
} from './integrations.tokens';

// Re-export tokens for convenience
export {
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
} from './integrations.tokens';

@Module({
  imports: [IdentifierMappingModule], // For ConnectionPort
  providers: [
    AdapterRegistryService,
    IntegrationsService,
    {
      provide: ADAPTER_REGISTRY_TOKEN,
      useExisting: AdapterRegistryService,
    },
    {
      provide: INTEGRATIONS_SERVICE_TOKEN,
      useExisting: IntegrationsService,
    },
  ],
  exports: [
    ADAPTER_REGISTRY_TOKEN,
    INTEGRATIONS_SERVICE_TOKEN,
    IntegrationsService,
  ],
})
export class IntegrationsModule {}

