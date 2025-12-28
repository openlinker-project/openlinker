/**
 * Inventory Module Exports
 *
 * Public API for the inventory module. Exports ports, types, and domain entities
 * for use by other modules and adapters.
 *
 * @module libs/core/src/inventory
 */

// Ports
export { InventoryMasterPort, Inventory } from './domain/ports/inventory-master.port';

// Types
export { InventoryAdjustment } from './domain/types/inventory.types';

