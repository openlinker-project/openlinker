/**
 * Mappings API Module
 *
 * NestJS module that wires the mappings HTTP layer. Imports the core MappingsModule
 * for service/repository providers and registers both mapping controllers.
 *
 * @module apps/api/src/mappings
 */

import { Module } from '@nestjs/common';
import { MappingsModule as CoreMappingsModule } from '@openlinker/core/mappings';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { CategoriesModule } from '../categories/categories.module';
import { MappingsController } from './http/mappings.controller';
import { MappingOptionsController } from './http/mapping-options.controller';
import { FulfillmentRoutingController } from './http/fulfillment-routing.controller';

@Module({
  // - CoreIntegrationsModule provides INTEGRATIONS_SERVICE_TOKEN — the
  //   mapping-options controller resolves per-connection adapters through it
  //   (#472). The adapter registry itself is populated by the platform
  //   integration modules imported elsewhere in the app shell.
  // - IdentifierMappingModule provides CONNECTION_PORT_TOKEN — the controller
  //   uses it to resolve the partner connection (Allegro↔PrestaShop) before
  //   calling getCapabilityAdapter (#479). CoreIntegrationsModule imports
  //   IdentifierMappingModule but does not re-export the token, so the
  //   import here is direct.
  imports: [CoreMappingsModule, CoreIntegrationsModule, IdentifierMappingModule, CategoriesModule],
  controllers: [MappingsController, MappingOptionsController, FulfillmentRoutingController],
})
export class MappingsApiModule {}
