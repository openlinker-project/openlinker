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
import { MappingsController } from './http/mappings.controller';
import { MappingOptionsController } from './http/mapping-options.controller';

@Module({
  imports: [CoreMappingsModule],
  controllers: [MappingsController, MappingOptionsController],
})
export class MappingsApiModule {}
