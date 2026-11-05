/**
 * Shopify Product Publish GraphQL Documents
 *
 * The operations the ProductPublisher prototype issues against the Admin
 * GraphQL API 2026-10, with the slices of their payloads it reads.
 *
 * Every product read and write selects the same `OlPublishedProduct` fragment,
 * so a pre-write read and a write response answer the same questions: which
 * variants exist (and with which option values), where their inventory item
 * stands at the configured location, whether the product has media, and which
 * collections it is in.
 *
 * PROTOTYPE (#3928).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/product-publisher
 */
import type { ShopifyConnection } from '../../../domain/types/shopify-api.types';
import type { ShopifyMetafieldDefinitionNode } from './shopify-product-metafields.mapper';

const PUBLISHED_PRODUCT_FRAGMENT = `fragment OlPublishedProduct on Product {
  id
  status
  media(first: 1) { nodes { id } }
  collections(first: 50) { nodes { id } }
  options { name }
  variants(first: 100) {
    nodes {
      id
      selectedOptions { name value }
      inventoryItem {
        id
        inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } }
      }
    }
  }
}`;

export const PUBLISH_TARGET_QUERY = `query OlPublishTarget($id: ID!, $locationId: ID!) {
  product(id: $id) { ...OlPublishedProduct }
}
${PUBLISHED_PRODUCT_FRAGMENT}`;

export const PRODUCT_SET_MUTATION = `mutation OlProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers, $locationId: ID!) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product { ...OlPublishedProduct }
    userErrors { field message code }
  }
}
${PUBLISHED_PRODUCT_FRAGMENT}`;

export const VARIANTS_BULK_CREATE_MUTATION = `mutation OlVariantsCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message code }
  }
}`;

export const VARIANTS_BULK_UPDATE_MUTATION = `mutation OlVariantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
    productVariants { id }
    userErrors { field message code }
  }
}`;

export const INVENTORY_SET_MUTATION = `mutation OlInventorySet($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { createdAt }
    userErrors { field message code }
  }
}`;

export const PUBLICATIONS_QUERY = `query OlPublications {
  publications(first: 20) { nodes { id catalog { title } } }
}`;

export const PUBLISHABLE_PUBLISH_MUTATION = `mutation OlPublish($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    userErrors { field message }
  }
}`;

export const COLLECTION_BY_HANDLE_QUERY = `query OlCollectionByHandle($handle: String!) {
  collectionByIdentifier(identifier: { handle: $handle }) { id handle title }
}`;

export const COLLECTION_CREATE_MUTATION = `mutation OlCollectionCreate($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection { id handle }
    userErrors { field message }
  }
}`;

export const COLLECTION_ADD_PRODUCTS_MUTATION = `mutation OlCollectionAdd($id: ID!, $productIds: [ID!]!) {
  collectionAddProductsV2(id: $id, productIds: $productIds) {
    job { id done }
    userErrors { field message code }
  }
}`;

/** Upsert of the listed metafields only; others on the product are left alone. At most 25 per call. */
export const METAFIELDS_SET_MUTATION = `mutation OlMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key }
    userErrors { field message code }
  }
}`;

export const PRODUCT_METAFIELD_DEFINITIONS_QUERY = `query OlProductMetafieldDefinitions($first: Int!, $after: String) {
  metafieldDefinitions(ownerType: PRODUCT, first: $first, after: $after) {
    nodes { id name namespace key type { name } validations { name value } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export interface MetafieldDefinitionsQuery {
  readonly metafieldDefinitions: ShopifyConnection<ShopifyMetafieldDefinitionNode>;
}

export interface PublishedVariantNode {
  readonly id: string;
  readonly selectedOptions: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly inventoryItem: {
    readonly id: string;
    readonly inventoryLevel: {
      readonly quantities: ReadonlyArray<{ readonly name: string; readonly quantity: number }>;
    } | null;
  } | null;
}

export interface PublishedProductNode {
  readonly id: string;
  readonly status: string;
  readonly media: ShopifyConnection<{ readonly id: string }>;
  readonly collections: ShopifyConnection<{ readonly id: string }>;
  readonly options: ReadonlyArray<{ readonly name: string }>;
  readonly variants: ShopifyConnection<PublishedVariantNode>;
}

export interface PublishTargetQuery {
  readonly product: PublishedProductNode | null;
}

export interface ProductSetPayload {
  readonly product: PublishedProductNode | null;
}

export interface VariantsBulkPayload {
  readonly productVariants: ReadonlyArray<{ readonly id: string }> | null;
}

export interface PublicationsQuery {
  readonly publications: ShopifyConnection<{ readonly id: string; readonly catalog: { readonly title: string } | null }>;
}

export interface PublishablePublishPayload {
  readonly userErrors?: ReadonlyArray<{ readonly message: string }>;
}

export interface CollectionNode {
  readonly id: string;
  readonly handle: string;
}

export interface CollectionByHandleQuery {
  readonly collectionByIdentifier: CollectionNode | null;
}

export interface CollectionCreatePayload {
  readonly collection: CollectionNode | null;
}
