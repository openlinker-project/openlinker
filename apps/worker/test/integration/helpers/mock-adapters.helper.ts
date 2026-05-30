/**
 * Mock Adapter Helpers
 *
 * Utilities for creating mock adapters for integration tests.
 * These mocks return test data without making real API calls.
 *
 * @module apps/worker/test/integration/helpers
 */
import { ProductMasterPort, Product, ProductVariant } from '@openlinker/core/products';
import { InventoryMasterPort, Inventory } from '@openlinker/core/inventory';
import { randomUUID } from 'crypto';

/**
 * Create a mock PrestaShop Product Master adapter
 *
 * Returns test product data without making real API calls.
 */
export function createMockPrestashopProductAdapter(): ProductMasterPort {
  return {
    getProduct: jest.fn().mockImplementation(async (productId: string): Promise<Product> => {
      // Return product with the ID that was passed in (internal ID from identifier mapping)
      return {
        id: productId, // Use the internal ID passed to getProduct
        name: 'Test Product',
        sku: 'TEST-SKU-001',
        price: 19.99,
        currency: null,
        description: 'Test Product Description',
        images: ['http://example.com/image1.jpg', 'http://example.com/image2.jpg'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    getProductVariants: jest.fn().mockImplementation(async (productId: string): Promise<ProductVariant[]> => {
      return [
        {
          id: `ol_variant_${randomUUID()}`,
          productId,
          sku: 'TEST-VARIANT-SKU-001',
          attributes: { size: 'M', color: 'Blue' },
          ean: null,
          gtin: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
    }),
    getProducts: jest.fn().mockResolvedValue([]),
    getCategories: jest.fn().mockResolvedValue([]),
    createProduct: jest.fn(),
    updateProduct: jest.fn(),
    deleteProduct: jest.fn(),
  } as unknown as ProductMasterPort;
}

/**
 * Create a mock PrestaShop Inventory Master adapter
 *
 * Returns test inventory data without making real API calls.
 */
export function createMockPrestashopInventoryAdapter(): InventoryMasterPort {
  return {
    getInventory: jest.fn().mockImplementation(async (productId: string): Promise<Inventory> => {
      return {
        id: `ol_inventory_${randomUUID()}`,
        productId,
        variantId: undefined,
        locationId: undefined,
        quantity: 100,
        reserved: 10,
        available: 90,
        updatedAt: new Date(),
      };
    }),
    adjustInventory: jest.fn(),
    reserveInventory: jest.fn(),
    releaseInventory: jest.fn(),
    getAvailableQuantity: jest.fn(),
  } as unknown as InventoryMasterPort;
}

