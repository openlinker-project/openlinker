/**
 * Shopify Admin GraphQL Response Types
 *
 * The slices of the Admin GraphQL schema (API 2026-10) the adapters select.
 * Only fields a query actually asks for are declared, and every one Shopify
 * may omit or null is typed so. Money scalars arrive as decimal STRINGS.
 *
 * @module libs/integrations/shopify/src/domain/types
 */

export interface ShopifyGraphqlErrorEntry {
  readonly message: string;
  readonly extensions?: { readonly code?: string } | null;
}

export interface ShopifyThrottleStatus {
  readonly maximumAvailable: number;
  readonly currentlyAvailable: number;
  readonly restoreRate: number;
}

export interface ShopifyGraphqlEnvelope<T> {
  readonly data?: T | null;
  readonly errors?: readonly ShopifyGraphqlErrorEntry[];
  readonly extensions?: {
    readonly cost?: {
      readonly requestedQueryCost?: number;
      readonly throttleStatus?: ShopifyThrottleStatus;
    };
  };
}

export interface ShopifyPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface ShopifyConnection<T> {
  readonly nodes: readonly T[];
  readonly pageInfo?: ShopifyPageInfo;
}

export interface ShopifyMoney {
  readonly amount: string;
  readonly currencyCode?: string;
}

export interface ShopifyMoneyBag {
  readonly shopMoney: ShopifyMoney;
}

export interface ShopifyWeight {
  readonly value: number;
  readonly unit: 'KILOGRAMS' | 'GRAMS' | 'POUNDS' | 'OUNCES';
}

export interface ShopifyMediaNode {
  readonly image?: { readonly url: string } | null;
}

export interface ShopifyTaxonomyCategory {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  readonly ancestorIds: readonly string[];
}

export interface ShopifyInventoryQuantity {
  readonly name: string;
  readonly quantity: number;
}

export interface ShopifyInventoryLevel {
  readonly updatedAt?: string | null;
  readonly quantities: readonly ShopifyInventoryQuantity[];
}

export interface ShopifyInventoryItem {
  readonly id: string;
  readonly tracked: boolean;
  readonly measurement?: { readonly weight?: ShopifyWeight | null } | null;
  /** Present only when the query selected it for one location. */
  readonly inventoryLevel?: ShopifyInventoryLevel | null;
}

export interface ShopifyVariant {
  readonly id: string;
  readonly title: string;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly price: string;
  readonly updatedAt?: string;
  readonly selectedOptions: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly inventoryItem: ShopifyInventoryItem;
  readonly media?: ShopifyConnection<ShopifyMediaNode>;
}

export interface ShopifyProduct {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly descriptionHtml: string;
  readonly status: string;
  readonly vendor: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly category: ShopifyTaxonomyCategory | null;
  readonly media: ShopifyConnection<ShopifyMediaNode>;
  readonly variants: ShopifyConnection<ShopifyVariant>;
}

export interface ShopifyMailingAddress {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly company: string | null;
  readonly address1: string | null;
  readonly address2: string | null;
  readonly city: string | null;
  readonly provinceCode: string | null;
  readonly zip: string | null;
  readonly countryCodeV2: string | null;
  readonly phone: string | null;
}

export interface ShopifyTaxLine {
  readonly rate: number | null;
  readonly ratePercentage: number | null;
  readonly title: string;
}

export interface ShopifyLineItem {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly quantity: number;
  /** Quantity after order edits and removals; `quantity` is the original. */
  readonly currentQuantity: number;
  readonly variant: { readonly id: string } | null;
  readonly product: { readonly id: string } | null;
  readonly originalUnitPriceSet: ShopifyMoneyBag;
  readonly discountedUnitPriceSet: ShopifyMoneyBag;
  readonly taxLines: readonly ShopifyTaxLine[];
}

export interface ShopifyShippingLine {
  readonly title: string;
  readonly code: string | null;
  readonly originalPriceSet: ShopifyMoneyBag;
  readonly taxLines: readonly ShopifyTaxLine[];
}

export interface ShopifyFulfillmentOrderLineItem {
  readonly id: string;
  readonly remainingQuantity: number;
}

export interface ShopifyFulfillmentOrder {
  readonly id: string;
  readonly status: string;
  readonly assignedLocation: { readonly location: { readonly id: string } | null } | null;
  readonly lineItems?: ShopifyConnection<ShopifyFulfillmentOrderLineItem>;
}

export type ShopifyPurchasingEntity =
  | { readonly __typename: 'Customer' }
  | {
      readonly __typename: 'PurchasingCompany';
      readonly location: {
        readonly taxSettings: { readonly taxRegistrationId: string | null } | null;
      } | null;
    };

export interface ShopifyOrder {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly processedAt: string | null;
  readonly cancelledAt: string | null;
  readonly displayFinancialStatus: string | null;
  readonly displayFulfillmentStatus: string;
  readonly paymentGatewayNames: readonly string[];
  readonly email: string | null;
  readonly phone: string | null;
  readonly note: string | null;
  readonly taxesIncluded: boolean;
  readonly currencyCode: string;
  readonly customer: { readonly id: string } | null;
  readonly currentTotalPriceSet: ShopifyMoneyBag;
  readonly currentSubtotalPriceSet: ShopifyMoneyBag;
  readonly currentTotalTaxSet: ShopifyMoneyBag;
  readonly totalShippingPriceSet: ShopifyMoneyBag;
  readonly purchasingEntity: ShopifyPurchasingEntity | null;
  readonly shippingAddress: ShopifyMailingAddress | null;
  readonly billingAddress: ShopifyMailingAddress | null;
  readonly shippingLines: ShopifyConnection<ShopifyShippingLine>;
  readonly lineItems: ShopifyConnection<ShopifyLineItem>;
}

/** A row of the order feed: just enough to order, filter and key the events. */
export interface ShopifyOrderFeedRow {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
}

export interface ShopifyShopInfo {
  readonly name: string;
  readonly currencyCode: string;
  readonly taxesIncluded: boolean;
}
