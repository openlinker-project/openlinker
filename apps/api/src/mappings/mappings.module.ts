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
import { CategoriesModule } from '../categories/categories.module';
import { MappingsController } from './http/mappings.controller';
import { MappingOptionsController } from './http/mapping-options.controller';

@Module({
  // CoreIntegrationsModule provides INTEGRATIONS_SERVICE_TOKEN — the
  // mapping-options controller resolves per-connection adapters through it
  // (#472). The adapter registry itself is populated by the platform
  // integration modules imported elsewhere in the app shell.
  imports: [CoreMappingsModule, CoreIntegrationsModule, CategoriesModule],
  controllers: [MappingsController, MappingOptionsController],
})
export class MappingsApiModule {}
