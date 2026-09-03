/**
 * Shipment Response DTO
 *
 * HTTP projection of the `Shipment` domain entity for the `/shipments` read +
 * command API (#846). Exposes only shipment fields — no secrets/credentials;
 * `connectionId` is a UUID reference, not a credential. Timestamps are
 * serialized as ISO-8601 strings.
 *
 * `errorMessage` redaction (#1826): the raw carrier rejection text may embed
 * address fragments (a rejected sender/recipient postcode), which the
 * `viewer` role is not trusted to see (see `PermissionValues['shipments:write']`
 * in `@openlinker/core/users`). The FE's own redaction of this field is
 * enforced HERE too — not just client-side — because a `viewer` session can
 * otherwise read the raw value directly off this endpoint's JSON regardless
 * of what the UI hides. `fromDomain`'s `canWrite` parameter (resolved by the
 * controller from the requester's role) is the single choke point every read
 * path goes through.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  ShipmentDirectionValues,
  ShipmentStatusValues,
  ShippingMethodValues,
  DeliveryIntentValues,
  ShipmentStatus,
  ShippingMethod,
 ShipmentDirection } from '@openlinker/core/shipping';
import type { Shipment, DeliveryIntent } from '@openlinker/core/shipping';
import type { OrderSummary } from '@openlinker/core/orders';
import { OrderSummaryProjectionDto } from '../../../orders/http/dto/order-summary-projection.dto';

/** Mirrors the FE's redaction placeholder (`shipments-page.tsx`,
 *  `shipment-row-detail.tsx`) so the copy is identical regardless of which
 *  layer ends up doing the redacting for a given caller. */
export const REDACTED_ERROR_MESSAGE = 'Details hidden for this role.';

export class ShipmentResponseDto {
  @ApiProperty({ description: 'Internal shipment id (ol_shipment_*)' })
  id!: string;

  @ApiProperty({ description: 'Internal order id (ol_order_*)' })
  orderId!: string;

  @ApiProperty({
    nullable: true,
    description:
      "Internal customer id (ol_customer_*) of the shipment's order, resolved at the API layer; null when the order has no customer or is unknown. The client resolves the display name from it.",
  })
  customerId!: string | null;

  @ApiProperty({ description: 'Shipping-provider connection id (UUID)' })
  connectionId!: string;

  @ApiProperty({
    enum: ShipmentDirectionValues,
    description: "Which way the goods travel. 'outbound' is a seller-to-buyer shipment.",
  })
  direction!: ShipmentDirection;

  @ApiProperty({ enum: ShippingMethodValues })
  shippingMethod!: ShippingMethod;

  @ApiProperty({ enum: ShipmentStatusValues })
  status!: ShipmentStatus;

  @ApiProperty({ nullable: true, description: 'Provider-issued shipment id' })
  providerShipmentId!: string | null;

  @ApiProperty({ nullable: true, description: 'Paczkomat / pickup-point id' })
  paczkomatId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Source marketplace delivery-method id this shipment was routed from',
  })
  sourceDeliveryMethodId!: string | null;

  @ApiProperty({
    enum: DeliveryIntentValues,
    nullable: true,
    description:
      'Carrier-neutral delivery intent the dispatch was requested with (#979, ADR-020). Null for branch-1/omp projection rows (no label, no intent).',
  })
  deliveryIntent!: DeliveryIntent | null;

  @ApiProperty({ nullable: true })
  trackingNumber!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Actual carrier-of-record — distinct from the dispatcher (`connectionId.platformType`). Lowercase-kebab canonical form: `inpost`, `dpd`, `dhl`, `orlen`, `allegro-one-box`, etc. (see `KnownCarrierValues` in core). For Allegro Delivery brokered shipments this is the underlying courier resolved from `transportingInfo[].carrierId`; for InPost own-contract always `inpost`. Plugin-registered values pass through as-is (open string set). Drives the FE public-tracker URL composition.',
  })
  carrier!: string | null;

  @ApiProperty({ nullable: true, description: 'Opaque adapter reference to the label PDF' })
  labelPdfRef!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  dispatchedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  deliveredAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  failedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'Last provider/dispatch failure message' })
  errorMessage!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Structured rejection-code discriminator (#1918) from the same provider rejection that produced `errorMessage` — e.g. `preflight.missing-parcel-template`, `api.http-503`, or a carrier-surfaced code. Unlike `errorMessage`, this is NOT redacted for the `viewer` role: it is a short discriminator, not carrier prose that could embed address fragments.',
  })
  providerCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({
    nullable: true,
    type: OrderSummaryProjectionDto,
    description:
      "Order-identity projection (#1995) for the unified Order cell — null when no order record resolves for `orderId`, or its snapshot has no parseable items. Only populated on the list endpoint (`GET /shipments`); single-shipment reads pass null (not fetched there).",
  })
  orderSummary!: OrderSummaryProjectionDto | null;

  /**
   * @param canWrite Whether the requester holds `shipments:write` (resolved
   *   by the controller from `@CurrentUser()`'s role via `ROLE_PERMISSIONS`).
   *   Deliberately REQUIRED and un-defaulted: a default would make "forgot to
   *   thread the requester through a new read endpoint" a silent disclosure
   *   instead of a compile error.
   * @param orderSummary Batched order-identity projection (#1995), or `null`
   *   when not resolved for this call site. Also required (not defaulted) so
   *   a future read path can't silently omit it.
   */
  static fromDomain(
    shipment: Shipment,
    customerId: string | null,
    canWrite: boolean,
    orderSummary: OrderSummary | null,
  ): ShipmentResponseDto {
    const dto = new ShipmentResponseDto();
    dto.id = shipment.id;
    dto.orderId = shipment.orderId;
    dto.customerId = customerId;
    dto.connectionId = shipment.connectionId;
    dto.direction = shipment.direction;
    dto.shippingMethod = shipment.shippingMethod;
    dto.status = shipment.status;
    dto.providerShipmentId = shipment.providerShipmentId;
    dto.paczkomatId = shipment.paczkomatId;
    dto.sourceDeliveryMethodId = shipment.sourceDeliveryMethodId;
    dto.deliveryIntent = shipment.deliveryIntent;
    dto.trackingNumber = shipment.trackingNumber;
    dto.carrier = shipment.carrier;
    dto.labelPdfRef = shipment.labelPdfRef;
    dto.dispatchedAt = shipment.dispatchedAt?.toISOString() ?? null;
    dto.deliveredAt = shipment.deliveredAt?.toISOString() ?? null;
    dto.cancelledAt = shipment.cancelledAt?.toISOString() ?? null;
    dto.failedAt = shipment.failedAt?.toISOString() ?? null;
    dto.errorMessage =
      canWrite || shipment.errorMessage === null ? shipment.errorMessage : REDACTED_ERROR_MESSAGE;
    dto.providerCode = shipment.providerCode;
    dto.createdAt = shipment.createdAt.toISOString();
    dto.updatedAt = shipment.updatedAt.toISOString();
    dto.orderSummary = orderSummary ? OrderSummaryProjectionDto.fromSummary(orderSummary) : null;
    return dto;
  }
}
