/**
 * Inventory Movement Response DTOs (#3565)
 *
 * Response shape for GET /inventory/movements. One row is either a stock
 * movement (`kind: 'movement'`) or a reservation shown as "Promised"
 * (`kind: 'reservation'`), which never changes the stock.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InventoryHistoryKindValues,
  InventoryMovementOperatorReasonValues,
  InventoryMovementReasonValues,
  InventoryMovementSourceKindValues,
  type InventoryHistoryKind,
  type InventoryHistoryRow,
  type InventoryMovementOperatorReason,
  type InventoryMovementReason,
  type InventoryMovementSourceKind,
} from '@openlinker/core/inventory';

export class InventoryMovementResponseDto {
  @ApiProperty({ enum: InventoryHistoryKindValues })
  kind!: InventoryHistoryKind;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ nullable: true, type: String })
  productVariantId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  sku!: string | null;

  @ApiProperty({ nullable: true, type: String, description: "The product's name" })
  productName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  locationId!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'The master that owns the position' })
  sourceConnectionId!: string | null;

  @ApiProperty({
    enum: InventoryMovementReasonValues,
    nullable: true,
    description: 'Null on a reservation row',
  })
  reason!: InventoryMovementReason | null;

  @ApiProperty({
    description:
      'Movement: pending | applied | refused | in_doubt. Reservation: held | released | consumed | expired.',
  })
  status!: string;

  @ApiProperty({
    description:
      'Signed stock change for a movement (the requested one when it was refused or is in doubt); ' +
      'the promised quantity for a reservation, which changes no stock',
  })
  quantityDelta!: number;

  @ApiProperty({ nullable: true, type: Number })
  quantityBefore!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  quantityAfter!: number | null;

  @ApiProperty({ enum: InventoryMovementSourceKindValues, nullable: true })
  sourceKind!: InventoryMovementSourceKind | null;

  @ApiProperty({ nullable: true, type: String, description: 'Order id, return id, ...' })
  sourceRef!: string | null;

  @ApiProperty({ enum: InventoryMovementOperatorReasonValues, nullable: true })
  operatorReason!: InventoryMovementOperatorReason | null;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'The user who made a manual correction' })
  actorUserId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      "The actor's display name (never an email). Null when there is no actor or the user no longer exists.",
  })
  actorName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  refusalReason!: string | null;

  @ApiProperty({ nullable: true, type: String, description: "The adapter's own sentence" })
  refusalDetail!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      "The order's number (order, sale and reservation rows) or the return's external id; null when there is none",
  })
  sourceLabel!: string | null;
}

export class PaginatedInventoryMovementsResponseDto {
  @ApiProperty({ type: [InventoryMovementResponseDto] })
  items!: InventoryMovementResponseDto[];

  @ApiPropertyOptional({
    description: 'Total rows matching the filters. Omitted when ?withTotal=false.',
  })
  total?: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}

export function toInventoryMovementResponseDto(
  row: InventoryHistoryRow,
  actorNames: ReadonlyMap<string, string> = new Map()
): InventoryMovementResponseDto {
  return {
    kind: row.kind,
    id: row.id,
    productId: row.productId,
    productVariantId: row.productVariantId,
    sku: row.sku,
    productName: row.productName,
    locationId: row.locationId,
    sourceConnectionId: row.sourceConnectionId,
    reason: row.reason,
    status: row.status,
    quantityDelta: row.quantityDelta,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    operatorReason: row.operatorReason,
    note: row.note,
    actorUserId: row.actorUserId,
    actorName: row.actorUserId === null ? null : (actorNames.get(row.actorUserId) ?? null),
    refusalReason: row.refusalReason,
    refusalDetail: row.refusalDetail,
    occurredAt: row.occurredAt.toISOString(),
    sourceLabel: row.sourceLabel,
  };
}
