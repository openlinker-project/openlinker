/**
 * Generate Protocol DTO
 *
 * Request body for POST /shipments/bulk/protocol (#964). The OL shipment ids
 * (typically the dispatched ids from a prior bulk dispatch) to cover with one
 * carrier handover protocol. The service derives the carrier connection +
 * provider waybills from the persisted rows and asserts a single connection, so
 * the client never supplies a connection id or waybills directly.
 *
 * Capped at the same 25 as the dispatch (ADR-019): one protocol per bulk action.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BULK_DISPATCH_MAX_ITEMS } from './bulk-generate-labels.dto';

export class GenerateProtocolDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: BULK_DISPATCH_MAX_ITEMS,
    description: `OL shipment ids (ol_shipment_*) to cover with one handover protocol (1..${BULK_DISPATCH_MAX_ITEMS}).`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_DISPATCH_MAX_ITEMS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  shipmentIds!: string[];
}
