/**
 * Shopify Admin GraphQL Response Types
 *
 * The slices of the Admin GraphQL schema (API 2026-10) the plugin selects.
 * Only fields a query actually asks for are declared, and every one Shopify
 * may omit or null is typed so.
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

export interface ShopifyShopInfo {
  readonly id: string;
  readonly name: string;
  readonly myshopifyDomain: string;
  readonly currencyCode: string;
  readonly taxesIncluded: boolean;
  readonly billingAddress?: ShopifyShopAddress | null;
}

/** The parts of the shop's own address a tax calculation needs. */
export interface ShopifyShopAddress {
  readonly countryCodeV2: string | null;
  readonly provinceCode: string | null;
  readonly zip: string | null;
}

export interface ShopifyLocationNode {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
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
  /** The path, root first, " > "-separated. */
  readonly fullName: string;
  /** Ancestor GIDs, root first. */
  readonly ancestorIds: readonly string[];
}

/** `ProductStatus` (Admin API 2026-10). `UNLISTED` exists since 2025-10. */
export const ShopifyProductStatusValues = ['ACTIVE', 'ARCHIVED', 'DRAFT', 'UNLISTED'] as const;
export type ShopifyProductStatus = (typeof ShopifyProductStatusValues)[number];

export interface ShopifyVariant {
  readonly id: string;
  readonly title: string;
  readonly sku: string | null;
  /** Deprecated in 2026-10 in favour of `barcodes`; still answers the first barcode. */
  readonly barcode: string | null;
  /** Money: a decimal string in the shop currency. */
  readonly price: string;
  readonly updatedAt?: string;
  readonly selectedOptions: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly inventoryItem: {
    readonly id: string;
    readonly tracked: boolean;
    readonly measurement?: { readonly weight?: ShopifyWeight | null } | null;
  };
  readonly media?: ShopifyConnection<ShopifyMediaNode>;
}

export interface ShopifyProduct {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly descriptionHtml: string;
  /** Raw `ProductStatus`; an unknown value is treated as for sale. */
  readonly status: string;
  readonly isGiftCard: boolean;
  readonly vendor: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly category: ShopifyTaxonomyCategory | null;
  readonly media: ShopifyConnection<ShopifyMediaNode>;
  readonly variants: ShopifyConnection<ShopifyVariant>;
}

/** One `taxLines` entry of a calculated draft order. */
export interface ShopifyTaxLine {
  readonly title: string;
  readonly rate: number | null;
  readonly ratePercentage: number | null;
}

export interface ShopifyInventoryQuantity {
  readonly name: string;
  readonly quantity: number;
}

export interface ShopifyInventoryLevel {
  readonly updatedAt?: string | null;
  readonly quantities: readonly ShopifyInventoryQuantity[];
}

/** A variant with its inventory item and its level at ONE location (null when not stocked there). */
export interface ShopifyInventoryVariant {
  readonly id: string;
  readonly inventoryItem: {
    readonly id: string;
    readonly tracked: boolean;
    readonly inventoryLevel?: ShopifyInventoryLevel | null;
  };
}

export interface ShopifyInventoryProduct {
  readonly id: string;
  readonly status: string;
  readonly variants: ShopifyConnection<ShopifyInventoryVariant>;
}

/** Money in the shop's currency, as a decimal string. */
export interface ShopifyMoney {
  readonly amount: string;
  readonly currencyCode?: string;
}

export interface ShopifyMoneyBag {
  readonly shopMoney: ShopifyMoney;
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
  readonly discountedUnitPriceAfterAllDiscountsSet: ShopifyMoneyBag;
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
  /** The currency the buyer paid in; differs from `currencyCode` on a multi-currency store. */
  readonly presentmentCurrencyCode: string;
  readonly customer: { readonly id: string } | null;
  readonly currentTotalPriceSet: ShopifyMoneyBag;
  readonly currentSubtotalPriceSet: ShopifyMoneyBag;
  readonly currentTotalTaxSet: ShopifyMoneyBag;
  readonly currentShippingPriceSet: ShopifyMoneyBag;
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
