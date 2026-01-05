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

// Types
export { OrderFilters, OrderStatus, OrderStatusValues } from './domain/types/order.types';




