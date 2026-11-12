/**
 * Shopify Product Queries
 *
 * GraphQL documents of the ProductMaster reads (Admin API 2026-10), in one
 * place so every read selects a product the same way.
 *
 * Products are hydrated DIRECTLY (`product(id:)`, `nodes(ids:)`), never through
 * the `query:` search index: that index is eventually consistent and returns a
 * partial, shifting set seconds after a write (L-M1). Search is used only where
 * nothing else exists: the modified-since window and the operator's free-text
 * product search.
 *
 * Query cost: one query may not exceed 1000 points, and Shopify no longer
 * publishes how a connection is costed. Sized by the old published rule
 * (`2 + first x node`, nested connections multiplied), which is an upper bound:
 * a product reads its first 50 variants (one picture each), about 500 points,
 * and further variants are read by `PRODUCT_VARIANTS_PAGE_QUERY` in pages of 80.
 * The prototype's 250 variants with 5 pictures each would be about 4300.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */

/** Variants read with the product; the rest are paged. */
export const SHOPIFY_FIRST_VARIANTS = 50;
/** Variants per follow-up page. */
export const SHOPIFY_VARIANT_PAGE_SIZE = 80;
/** Ids per enumeration page (the Admin API's page maximum). */
export const SHOPIFY_ID_PAGE_SIZE = 250;
/**
 * Products per page of a list or bulk read (each carries its first variants).
 * The old cost rule would allow only one; the real cost is lower, so reads
 * start here and halve on `MAX_COST_EXCEEDED` (`shopify-cost-backoff`).
 */
export const SHOPIFY_PRODUCT_BATCH_SIZE = 10;

const CATEGORY_FIELDS = 'category { id name fullName ancestorIds }';

const VARIANT_FIELDS = `
  id title sku barcode price updatedAt
  selectedOptions { name value }
  inventoryItem { id tracked measurement { weight { value unit } } }
  media(first: 1) { nodes { ... on MediaImage { image { url } } } }
`;

export const PRODUCT_FIELDS = `
  id title handle descriptionHtml status isGiftCard vendor createdAt updatedAt
  ${CATEGORY_FIELDS}
  media(first: 20) { nodes { ... on MediaImage { image { url } } } }
  variants(first: ${SHOPIFY_FIRST_VARIANTS}) {
    nodes { ${VARIANT_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
`;

export const PRODUCT_BY_ID_QUERY = `query OlProduct($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`;

/** The variants of one product past its first page. */
export const PRODUCT_VARIANTS_PAGE_QUERY = `query OlProductVariantsPage($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: ${SHOPIFY_VARIANT_PAGE_SIZE}, after: $after) {
      nodes { ${VARIANT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** Several products at once (bulk prefetch, `filters.externalIds`); an unknown id answers null. */
export const PRODUCTS_BY_IDS_QUERY = `query OlProductsByIds($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } }
}`;

/** One page of products for a list read; `query` is the operator's search, or null. */
export const PRODUCTS_PAGE_QUERY = `query OlProductsPage($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: ID) {
    nodes { ${PRODUCT_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Product ids for the catalogue enumeration, with what the enumeration filters
 * on (archived products and gift cards are left out). A plain connection read,
 * not a search, so a just-written product is not missing from it.
 */
export const PRODUCT_IDS_PAGE_QUERY = `query OlProductIdsPage($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: ID) {
    nodes { id status isGiftCard }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Ids of products whose own record changed in a window (search index, lags writes by seconds). */
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

/** Only the taxonomy category of every product, for the category directory. */
export const PRODUCT_CATEGORIES_PAGE_QUERY = `query OlProductCategoriesPage($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: ID) {
    nodes { isGiftCard ${CATEGORY_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * The tax Shopify would charge for one variant shipped to an address,
 * computed without creating a draft order (`draftOrderCalculate`, needs
 * `write_draft_orders`). No shipping line is sent, so every tax line belongs
 * to the one item.
 */
export const DRAFT_ORDER_TAX_QUERY = `mutation OlDraftOrderTax($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    calculatedDraftOrder {
      taxesIncluded
      taxLines { title rate ratePercentage }
      lineItems { taxable }
    }
    userErrors { field message }
  }
}`;
