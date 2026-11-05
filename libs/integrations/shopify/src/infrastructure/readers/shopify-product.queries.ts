/**
 * Shopify Product Queries
 *
 * GraphQL documents of the ProductMaster and InventoryMaster reads, in one
 * place so both capabilities select a product the same way.
 *
 * Products are read DIRECTLY (`product(id:)`, `nodes(ids:)`), never resolved
 * through the `query:` search index: that index is eventually consistent and
 * returns a partial, shifting set seconds after a write (L-M1). Search is used
 * only where nothing else exists (the operator's free-text product search).
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */

/** Variants read per product; a product with more is read in part and warned about. */
export const SHOPIFY_VARIANTS_PER_PRODUCT = 250;

export const PRODUCT_FIELDS = `
  id title handle descriptionHtml status vendor createdAt updatedAt
  category { id name fullName ancestorIds }
  media(first: 20) { nodes { ... on MediaImage { image { url } } } }
  variants(first: ${SHOPIFY_VARIANTS_PER_PRODUCT}) {
    nodes {
      id title sku barcode price updatedAt
      selectedOptions { name value }
      inventoryItem { id tracked measurement { weight { value unit } } }
      media(first: 5) { nodes { ... on MediaImage { image { url } } } }
    }
    pageInfo { hasNextPage endCursor }
  }
`;

export const PRODUCT_BY_ID_QUERY = `query OlProduct($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`;

export const PRODUCTS_BY_IDS_QUERY = `query OlProductsByIds($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } }
}`;

export const PRODUCTS_PAGE_QUERY = `query OlProductsPage($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: ID) {
    nodes { ${PRODUCT_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const PRODUCT_IDS_PAGE_QUERY = `query OlProductIdsPage($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: ID) {
    nodes { id }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Ids of products whose own record changed in a window. Search index read
 * (`query:`), so it lags writes by seconds (L-M1); the caller's lookback covers it.
 */
export const MODIFIED_PRODUCT_IDS_QUERY = `query OlModifiedProductIds($first: Int!, $after: String, $query: String!) {
  products(first: $first, after: $after, query: $query, sortKey: ID) {
    nodes { id }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Parent ids of variants whose record changed in a window: a variant price
 * edit bumps only `variant.updatedAt`, never the product's (L-M2).
 */
export const MODIFIED_VARIANT_PRODUCT_IDS_QUERY = `query OlModifiedVariantProductIds($first: Int!, $after: String, $query: String!) {
  productVariants(first: $first, after: $after, query: $query, sortKey: ID) {
    nodes { product { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Only the taxonomy category of every product, for the category directory
 * (`getCategories`). A plain connection read, not a `query:` search.
 */
export const PRODUCT_CATEGORIES_PAGE_QUERY = `query OlProductCategoriesPage($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: ID) {
    nodes { category { id name fullName ancestorIds } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * A product's variants with their inventory level at ONE location. A variant
 * not stocked there answers `inventoryLevel: null`.
 */
export const PRODUCT_INVENTORY_QUERY = `query OlProductInventory($id: ID!, $locationId: ID!) {
  product(id: $id) {
    id
    variants(first: ${SHOPIFY_VARIANTS_PER_PRODUCT}) {
      nodes {
        id
        inventoryItem {
          id tracked
          inventoryLevel(locationId: $locationId) {
            updatedAt
            quantities(names: ["available", "on_hand", "committed"]) { name quantity }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
