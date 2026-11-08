/**
 * Shipment Summary DTOs (#4043)
 *
 * `GET /shipments/summary` takes the list's filters (no paging) and returns
 * the counts the shipments list shows on its status tabs, filter options and
 * "Needs a look". Each axis is counted with its own filter removed, so a count
 * is what choosing that tab or option would return.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty, OmitType } from '@nestjs/swagger';
import type { ShipmentStatus, ShipmentSummary, ShippingMethod } from '@openlinker/core/shipping';
import { ListShipmentsQueryDto } from './list-shipments-query.dto';
import { REDACTED_ERROR_MESSAGE } from './shipment-response.dto';

export class ShipmentSummaryQueryDto extends OmitType(ListShipmentsQueryDto, ['limit', 'offset'] as const) {}

export class ShipmentProcessorCountsDto {
  @ApiProperty({ description: 'Marketplace-fulfilled shipments (shipping method omp).' })
  omp!: number;

  @ApiProperty({ description: 'Shipments a carrier issued (a provider shipment id exists).' })
  carrier!: number;
}

export class ShipmentFailedCauseGroupDto {
  @ApiProperty({ description: 'The shipping-provider connection every member shares.' })
  connectionId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The provider code the members share, when any.' })
  providerCode!: string | null;

  @ApiProperty({
    description:
      'One member\'s carrier message. Redacted for a role without shipments:write, exactly as the row cells are.',
  })
  sampleReason!: string;

  @ApiProperty({ description: 'How many failed shipments share this cause.' })
  count!: number;
}

export class ShipmentSummaryResponseDto {
  @ApiProperty({ description: 'Shipments matching the filters, status removed.' })
  total!: number;

  @ApiProperty({
    description: 'Count per shipment status (status filter removed).',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  byStatus!: Record<ShipmentStatus, number>;

  @ApiProperty({ type: ShipmentProcessorCountsDto })
  byProcessor!: ShipmentProcessorCountsDto;

  @ApiProperty({
    description: 'Count per shipping method (method filter removed).',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  byMethod!: Record<ShippingMethod, number>;

  @ApiProperty({
    description: 'Count per shipping-provider connection id (connection filter removed); connections with none are left out.',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  byConnection!: Record<string, number>;

  @ApiProperty({ description: 'Shipments whose tracking number never reached the sales channel.' })
  waybillRelayStuck!: number;

  @ApiProperty({ description: 'Drafts and generated labels that are not marketplace-fulfilled.' })
  toSend!: number;

  @ApiProperty({ type: [ShipmentFailedCauseGroupDto], description: 'Up to five shared failure causes, largest first, across all pages.' })
  failedCauseGroups!: ShipmentFailedCauseGroupDto[];

  static fromDomain(summary: ShipmentSummary, canWrite: boolean): ShipmentSummaryResponseDto {
    const dto = new ShipmentSummaryResponseDto();
    dto.total = summary.total;
    dto.byStatus = summary.byStatus;
    dto.byProcessor = summary.byProcessor;
    dto.byMethod = summary.byMethod;
    dto.byConnection = summary.byConnection;
    dto.waybillRelayStuck = summary.waybillRelayStuck;
    dto.toSend = summary.toSend;
    dto.failedCauseGroups = summary.failedCauseGroups.map((group) => ({
      connectionId: group.connectionId,
      providerCode: group.providerCode,
      sampleReason: canWrite ? group.sampleReason : REDACTED_ERROR_MESSAGE,
      count: group.count,
    }));
    return dto;
  }
}
