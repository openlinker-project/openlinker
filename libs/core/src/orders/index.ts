/**
 * Orders Module Exports
 *
 * Public API for the orders module. Exports ports, types, and domain entities
 * for use by other modules and adapters.
 *
 * @module libs/core/src/orders
 */

// Ports
export { OrderSourcePort, Order, OrderItem, OrderTotals, Address } from './domain/ports/order-source.port';
export { OrderProcessorManagerPort } from './domain/ports/order-processor-manager.port';

// Types
export { OrderFilters, OrderStatus, OrderStatusValues } from './domain/types/order.types';
export { OrderCreate, OrderRef } from './domain/types/order-processor.types';

// Services
export { IOrderSyncService, OrderSyncRequest, OrderSyncResult } from './application/interfaces/order-sync.service.interface';
export { IOrderRecordService } from './application/interfaces/order-record.service.interface';
export { OrderRecordService } from './application/services/order-record.service';
export { ORDER_SYNC_SERVICE_TOKEN, ORDER_RECORD_REPOSITORY_TOKEN, ORDER_RECORD_SERVICE_TOKEN } from './orders.tokens';

// Domain entities
export { OrderRecord, OrderSyncStatus } from './domain/entities/order-record.entity';

// Domain exceptions
export { OrderRecordNotFoundException } from './domain/exceptions/order-record-not-found.exception';

// Ports
export { OrderRecordRepositoryPort } from './domain/ports/order-record-repository.port';

// Module
export { OrdersModule } from './orders.module';




