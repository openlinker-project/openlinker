/**
 * Fulfilment work shipment response DTO (#3292)
 *
 * The operator-facing projection of one `Shipment` row for the fulfilment
 * work detail page's "Shipment" panel — never the full domain entity, which
 * carries more than the panel needs (raw provider error messages, the
 * carrier's own rejection code, the waybill-relay bookkeeping).
 *
 * `hasLabel` rather than a raw `labelPdfRef` — the panel's only question about
 * the label is whether one exists, and the ref itself is an opaque storage
 * key an operator cannot act on directly; the download route is reached by
 * `shipmentId`, not by this field.
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShipmentStatusValues, type ShipmentStatus } from '@openlinker/core/shipping';

export class FulfillmentWorkShipmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ShipmentStatusValues }) status!: ShipmentStatus;
  @ApiPropertyOptional({
    nullable: true,
    description: "The carrier-of-record (#769); null before the carrier is known.",
  })
  carrier!: string | null;
  @ApiPropertyOptional({ nullable: true }) trackingNumber!: string | null;
  @ApiProperty({ description: 'Whether a label PDF has been generated for this shipment.' })
  hasLabel!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ nullable: true }) dispatchedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) deliveredAt!: Date | null;
}
