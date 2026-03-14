/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the inventory module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/inventory
 */

// Token for dependency injection (interfaces can't be used as values)
export const INVENTORY_REPOSITORY_TOKEN = Symbol('InventoryRepositoryPort');
export const INVENTORY_SERVICE_TOKEN = Symbol('IInventoryService');
export const INVENTORY_SYNC_SERVICE_TOKEN = Symbol('IInventorySyncService');
export const MASTER_INVENTORY_SYNC_SERVICE_TOKEN = Symbol('IMasterInventorySyncService');

