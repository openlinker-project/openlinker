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
import { ProductsModule } from '@openlinker/core/products';
import { InventoryController } from './http/inventory.controller';

@Module({
  imports: [CoreInventoryModule, ProductsModule],
  controllers: [InventoryController],
})
export class InventoryModule {}
