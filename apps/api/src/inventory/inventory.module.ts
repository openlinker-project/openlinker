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
import { UsersApiModule } from '../users/users.module';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { OperationalSettingsModule } from '@openlinker/core/operational-settings';
import { OrdersModule } from '@openlinker/core/orders';
import { ProductsModule as CoreProductsModule } from '@openlinker/core/products';
import { ListingsModule } from '@openlinker/core/listings/services';
// The HOST integrations module (apps/api): it re-exports the core one that
// carries INTEGRATIONS_SERVICE_TOKEN. Aliased because both export one name.
import { IntegrationsModule as HostIntegrationsModule } from '../integrations/integrations.module';
import { StockViewService } from './application/services/stock-view.service';
import { InventoryController } from './http/inventory.controller';
import { InventoryMovementsController } from './http/inventory-movements.controller';
import { InventoryCorrectionController } from './http/inventory-correction.controller';
import { InventoryLocationsController } from './http/inventory-locations.controller';

@Module({
  // The stock view composes inventory with listings (channels, snapshots),
  // products, orders (hold order numbers) and settings (stale threshold) at the
  // interface layer, because core `inventory` may not import `listings`.
  imports: [
    CoreInventoryModule,
    CoreProductsModule,
    ListingsModule,
    OrdersModule,
    IdentifierMappingModule,
    OperationalSettingsModule,
    HostIntegrationsModule,
    UsersApiModule,
  ],
  controllers: [
    InventoryController,
    InventoryLocationsController,
    InventoryMovementsController,
    InventoryCorrectionController,
  ],
  providers: [StockViewService],
})
export class InventoryModule {}
