/**
 * Inventory API Module
 *
 * NestJS module for inventory read API endpoints. Imports core inventory
 * module and registers the inventory controller.
 *
 * @module apps/api/src/inventory
 */
import { Module } from '@nestjs/common';
import { InventoryModule as CoreInventoryModule } from '@openlinker/core/inventory';
import { InventoryController } from './http/inventory.controller';

@Module({
  imports: [CoreInventoryModule],
  controllers: [InventoryController],
})
export class InventoryModule {}
