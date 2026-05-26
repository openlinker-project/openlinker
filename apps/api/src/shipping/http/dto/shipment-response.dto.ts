/**
 * Shipment Response DTO
 *
 * HTTP projection of the `Shipment` domain entity for the `/shipments` read +
 * command API (#846). Exposes only shipment fields — no secrets/credentials;
 * `connectionId` is a UUID reference, not a credential. Timestamps are
 * serialized as ISO-8601 strings.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ShipmentStatusValues, ShippingMethodValues , ShipmentStatus, ShippingMethod } from '@openlinker/core/shipping';
import type { Shipment } from '@openlinker/core/shipping';

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

  @ApiProperty({ nullable: true })
  trackingNumber!: string | null;

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

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  static fromDomain(shipment: Shipment, customerId: string | null = null): ShipmentResponseDto {
    const dto = new ShipmentResponseDto();
    dto.id = shipment.id;
    dto.orderId = shipment.orderId;
    dto.customerId = customerId;
    dto.connectionId = shipment.connectionId;
    dto.shippingMethod = shipment.shippingMethod;
    dto.status = shipment.status;
    dto.providerShipmentId = shipment.providerShipmentId;
    dto.paczkomatId = shipment.paczkomatId;
    dto.sourceDeliveryMethodId = shipment.sourceDeliveryMethodId;
    dto.trackingNumber = shipment.trackingNumber;
    dto.labelPdfRef = shipment.labelPdfRef;
    dto.dispatchedAt = shipment.dispatchedAt?.toISOString() ?? null;
    dto.deliveredAt = shipment.deliveredAt?.toISOString() ?? null;
    dto.cancelledAt = shipment.cancelledAt?.toISOString() ?? null;
    dto.failedAt = shipment.failedAt?.toISOString() ?? null;
    dto.errorMessage = shipment.errorMessage;
    dto.createdAt = shipment.createdAt.toISOString();
    dto.updatedAt = shipment.updatedAt.toISOString();
    return dto;
  }
}
