/**
 * Shopify Inventory Queries
 *
 * GraphQL documents of the InventoryMaster (Admin API 2026-10): a product's
 * variants with their level at ONE location, read directly (never through the
 * search index, L-M1), and the compare-and-set stock write.
 *
 * Cost: one query may not exceed 1000 points. A variant row here is about five
 * points by the old published rule, so a product reads 100 variants per page
 * and the bulk read starts at 10 products and halves on `MAX_COST_EXCEEDED`.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */

/** Variants per page of an inventory read. */
export const SHOPIFY_INVENTORY_VARIANT_PAGE_SIZE = 100;

/** The quantity names read; `available` is the sellable figure and the one written. */
export const SHOPIFY_INVENTORY_QUANTITY_NAMES = ['available', 'on_hand', 'committed'] as const;

/** Levels read per inventory item in the all-locations mode (more are paged by a follow-up read). */
export const SHOPIFY_INVENTORY_LEVELS_PAGE_SIZE = 50;

const INVENTORY_VARIANT_FIELDS = `
  id
  inventoryItem {
    id tracked
    inventoryLevel(locationId: $locationId) {
      updatedAt
      quantities(names: ["available", "on_hand", "committed"]) { name quantity }
    }
    levels: inventoryLevels(first: ${SHOPIFY_INVENTORY_LEVELS_PAGE_SIZE}) @include(if: $allLocations) {
      nodes {
        location { id }
        updatedAt
        quantities(names: ["available", "on_hand", "committed"]) { name quantity }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const INVENTORY_PRODUCT_FIELDS = `
  id status
  variants(first: ${SHOPIFY_INVENTORY_VARIANT_PAGE_SIZE}, after: $after) {
    nodes { ${INVENTORY_VARIANT_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
`;

/** One product's variants at the location, one page (`$after` null for the first). */
export const PRODUCT_INVENTORY_QUERY = `query OlProductInventory($id: ID!, $locationId: ID!, $after: String, $allLocations: Boolean!) {
  product(id: $id) { ${INVENTORY_PRODUCT_FIELDS} }
}`;

/** Several products' first variant page at the location (bulk prefetch); an unknown id answers null. */
export const PRODUCTS_INVENTORY_BY_IDS_QUERY = `query OlProductsInventory($ids: [ID!]!, $locationId: ID!, $after: String, $allLocations: Boolean!) {
  nodes(ids: $ids) { ... on Product { ${INVENTORY_PRODUCT_FIELDS} } }
}`;

/**
 * A delta on `available` at one location, compare-and-set on the level read
 * just before (`changeFromQuantity`) and idempotent (`@idempotent`, required
 * since 2026-04). A moved level answers `CHANGE_FROM_QUANTITY_STALE` and
 * writes nothing.
 */
export const ADJUST_AVAILABLE_MUTATION = `mutation OlAdjustAvailable($input: InventoryAdjustQuantitiesInput!, $key: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { createdAt changes { name delta quantityAfterChange } }
    userErrors { field message code }
  }
}`;

/** The product an inventory item belongs to (stock-level webhook resolution); null for an unknown item. */
export const INVENTORY_ITEM_PRODUCT_QUERY = `query OlInventoryItemProduct($id: ID!) {
  inventoryItem(id: $id) { id variant { id product { id } } }
}`;

/** Levels read per follow-up page of one item whose first page was full. */
export const SHOPIFY_INVENTORY_LEVELS_FOLLOWUP_PAGE_SIZE = 250;

/** The remaining levels of ONE inventory item, after the cursor of the nested read. */
export const INVENTORY_ITEM_LEVELS_QUERY = `query OlInventoryItemLevels($id: ID!, $after: String) {
  inventoryItem(id: $id) {
    id
    levels: inventoryLevels(first: ${SHOPIFY_INVENTORY_LEVELS_FOLLOWUP_PAGE_SIZE}, after: $after) {
      nodes {
        location { id }
        updatedAt
        quantities(names: ["available", "on_hand", "committed"]) { name quantity }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
