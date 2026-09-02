/**
 * Inventory API Module
 *
 * NestJS module for the inventory read API and the operator-authored
 * inventory-locations CRUD API (#2316). Imports the core inventory module,
 * which already exports LOCATION_SERVICE_TOKEN.
 *
 * @module apps/api/src/inventory
 */
import { Module } from '@nestjs/common';
import { InventoryModule as CoreInventoryModule } from '@openlinker/core/inventory';
import { InventoryController } from './http/inventory.controller';
import { InventoryLocationsController } from './http/inventory-locations.controller';

@Module({
  imports: [CoreInventoryModule],
  controllers: [InventoryController, InventoryLocationsController],
})
export class InventoryModule {}
