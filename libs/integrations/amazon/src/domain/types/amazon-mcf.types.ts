/**
 * Amazon Multi-Channel Fulfillment Wire Types (#4185)
 *
 * The subset of the Fulfillment Outbound API v2020-07-01 the MCF executor
 * uses, from Amazon's published model (`fulfillmentOutbound_2020-07-01.json`).
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export const AmazonMcfShippingSpeedValues = ['Standard', 'Expedited', 'Priority'] as const;
export type AmazonMcfShippingSpeed = (typeof AmazonMcfShippingSpeedValues)[number];

export interface AmazonMcfAddress {
  readonly name: string;
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly city: string;
  readonly stateOrRegion?: string;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly phone?: string;
}

export interface AmazonMcfItemRequest {
  readonly sellerSku: string;
  readonly sellerFulfillmentOrderItemId: string;
  readonly quantity: number;
}

export interface AmazonMcfCreateRequest {
  readonly marketplaceId: string;
  readonly sellerFulfillmentOrderId: string;
  readonly displayableOrderId: string;
  readonly displayableOrderDate: string;
  readonly displayableOrderComment: string;
  readonly shippingSpeedCategory: AmazonMcfShippingSpeed;
  readonly destinationAddress: AmazonMcfAddress;
  readonly items: readonly AmazonMcfItemRequest[];
}

export interface AmazonMcfPreviewResponse {
  readonly payload?: {
    readonly fulfillmentPreviews?: ReadonlyArray<{
      readonly shippingSpeedCategory?: string;
      readonly isFulfillable?: boolean;
      readonly unfulfillablePreviewItems?: ReadonlyArray<{
        readonly sellerSku?: string;
        readonly itemUnfulfillableReasons?: readonly string[];
      }>;
    }>;
  };
}

/** `New`, `Received`, `Planning`, `Processing`, `Cancelled`, `Complete`, `CompletePartialled`, `Unfulfillable`, `Invalid`. */
export type AmazonMcfOrderStatus = string;

export interface AmazonMcfOrderResponse {
  readonly payload?: {
    readonly fulfillmentOrder?: {
      readonly sellerFulfillmentOrderId: string;
      readonly fulfillmentOrderStatus: AmazonMcfOrderStatus;
      /** ISO 8601. */
      readonly receivedDate?: string;
      /** ISO 8601. */
      readonly statusUpdatedDate?: string;
    };
    readonly fulfillmentOrderItems?: ReadonlyArray<{
      readonly sellerSku?: string;
      readonly sellerFulfillmentOrderItemId: string;
      readonly quantity: number;
      readonly cancelledQuantity?: number;
      readonly unfulfillableQuantity?: number;
    }>;
    readonly fulfillmentShipments?: ReadonlyArray<{
      readonly amazonShipmentId?: string;
      /** `PENDING`, `SHIPPED`, `CANCELLED_BY_FULFILLER`, `CANCELLED_BY_SELLER`. */
      readonly fulfillmentShipmentStatus?: string;
      readonly fulfillmentShipmentItem?: ReadonlyArray<{
        readonly sellerFulfillmentOrderItemId?: string;
        readonly quantity?: number;
      }>;
      readonly fulfillmentShipmentPackage?: ReadonlyArray<{
        readonly carrierCode?: string;
        readonly trackingNumber?: string;
      }>;
    }>;
  };
}
