/**
 * Orders Module
 *
 * NestJS module for orders functionality. Configures services and exports
 * the order sync service for use in other modules.
 *
 * @module libs/core/src/orders
 */
import { Module } from '@nestjs/common';
import { OrderSyncService } from './application/services/order-sync.service';
import { ORDER_SYNC_SERVICE_TOKEN } from './orders.tokens';
import { IntegrationsModule } from '@openlinker/core/integrations';

// Re-export tokens for convenience
export { ORDER_SYNC_SERVICE_TOKEN } from './orders.tokens';

@Module({
  imports: [
    IntegrationsModule, // Required for INTEGRATIONS_SERVICE_TOKEN and ADAPTER_FACTORY_RESOLVER_TOKEN
  ],
  providers: [
    // Provide class directly first
    OrderSyncService,
    // Then provide token binding using useExisting
    {
      provide: ORDER_SYNC_SERVICE_TOKEN,
      useExisting: OrderSyncService,
    },
    // Also provide as string token for convenience
    {
      provide: 'IOrderSyncService',
      useExisting: ORDER_SYNC_SERVICE_TOKEN,
    },
  ],
  exports: [
    ORDER_SYNC_SERVICE_TOKEN,
    'IOrderSyncService',
  ],
})
export class OrdersModule {}

