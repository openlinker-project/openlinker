/**
 * Amazon Orders API Wire Types
 *
 * The subset of Orders API v2026-01-01 (`searchOrders`, `getOrder`) and v0
 * (`confirmShipment`) the order source reads and writes, taken from Amazon's
 * published model (`amzn/selling-partner-api-models`,
 * `orders-api-model/orders_2026-01-01.json`, `ordersV0.json`). Every field
 * Amazon marks optional is optional here; money amounts are decimal strings.
 *
 * @module libs/integrations/amazon/src/domain/types
 */

/** `Money`: `amount` is a decimal string with no loss of precision. */
export interface AmazonMoney {
  readonly amount: string;
  readonly currencyCode: string;
}

export const AmazonFulfillmentStatusValues = [
  'PENDING_AVAILABILITY',
  'PENDING',
  'UNSHIPPED',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'CANCELLED',
  'UNFULFILLABLE',
] as const;
export type AmazonFulfillmentStatus = (typeof AmazonFulfillmentStatusValues)[number];

/** `OrderFulfillment.fulfillmentServiceLevel`, documented values. */
export const AmazonServiceLevelValues = [
  'EXPEDITED',
  'FREE_ECONOMY',
  'NEXT_DAY',
  'PRIORITY',
  'SAME_DAY',
  'SECOND_DAY',
  'SCHEDULED',
  'STANDARD',
] as const;

export interface AmazonDateTimeRange {
  readonly earliestDateTime?: string;
  readonly latestDateTime?: string;
}

export interface AmazonCustomerAddress {
  readonly name?: string;
  readonly companyName?: string;
  readonly addressLine1?: string;
  readonly addressLine2?: string;
  readonly addressLine3?: string;
  readonly city?: string;
  readonly districtOrCounty?: string;
  readonly stateOrRegion?: string;
  readonly municipality?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
  readonly phone?: string;
}

export interface AmazonOrderItem {
  readonly orderItemId: string;
  readonly quantityOrdered: number;
  readonly product: {
    readonly asin?: string;
    readonly title?: string;
    readonly sellerSku?: string;
    readonly price?: { readonly unitPrice?: AmazonMoney };
  };
  readonly proceeds?: {
    readonly proceedsTotal?: AmazonMoney;
    readonly breakdowns?: readonly { readonly type: string; readonly subtotal: AmazonMoney }[];
  };
}

export interface AmazonOrderPackage {
  readonly packageReferenceId: string;
  readonly packageStatus?: { readonly status: string };
  readonly carrier?: string;
  readonly trackingNumber?: string;
  readonly shipTime?: string;
}

export interface AmazonOrder {
  readonly orderId: string;
  readonly createdTime: string;
  readonly lastUpdatedTime: string;
  readonly salesChannel: {
    readonly channelName: string;
    readonly marketplaceId?: string;
    readonly marketplaceName?: string;
  };
  readonly buyer?: {
    readonly buyerName?: string;
    readonly buyerEmail?: string;
    readonly buyerCompanyName?: string;
  };
  readonly recipient?: { readonly deliveryAddress?: AmazonCustomerAddress };
  readonly proceeds?: {
    readonly grandTotal?: AmazonMoney;
    readonly breakdowns?: readonly { readonly type: string; readonly subtotal: AmazonMoney }[];
  };
  readonly payment?: {
    readonly paymentExecutions?: readonly { readonly paymentMethod?: string; readonly paymentAmount?: AmazonMoney }[];
  };
  readonly tax?: {
    readonly taxRegistrations?: readonly {
      readonly taxRegistrationNumber?: string;
      readonly legalName?: string;
      readonly taxRegistrationAddress?: AmazonCustomerAddress;
    }[];
  };
  readonly fulfillment?: {
    readonly fulfillmentStatus: string;
    readonly fulfilledBy?: string;
    readonly fulfillmentServiceLevel?: string;
    readonly shipByWindow?: AmazonDateTimeRange;
    readonly deliverByWindow?: AmazonDateTimeRange;
  };
  readonly orderItems: readonly AmazonOrderItem[];
  readonly packages?: readonly AmazonOrderPackage[];
}

export interface AmazonSearchOrdersResponse {
  readonly orders: readonly AmazonOrder[];
  readonly pagination?: { readonly nextToken?: string };
  /** Upper bound of the window the search covered, when `lastUpdatedAfter` was used. */
  readonly lastUpdatedBefore?: string;
}

export interface AmazonGetOrderResponse {
  readonly order: AmazonOrder;
}

/** v0 `confirmShipment` body. */
export interface AmazonConfirmShipmentRequest {
  readonly marketplaceId: string;
  readonly packageDetail: {
    readonly packageReferenceId: string;
    readonly carrierCode: string;
    readonly carrierName?: string;
    readonly trackingNumber: string;
    readonly shipDate: string;
    readonly orderItems: readonly { readonly orderItemId: string; readonly quantity: number }[];
  };
}
