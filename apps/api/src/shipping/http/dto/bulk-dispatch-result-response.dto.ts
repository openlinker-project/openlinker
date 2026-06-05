/**
 * Bulk Dispatch Result Response DTO
 *
 * Response for POST /shipments/bulk/generate-labels (#964). Mirrors the core
 * `BulkShipmentDispatchResult` — a per-order outcome list. Each entry carries
 * its `orderId` and `kind`: `dispatched` includes the created shipment;
 * `omp_fulfilled` includes none (OMP ships externally); `failed` includes the
 * error message (the partial-failure case — successful siblings are untouched).
 *
 * The handover protocol is NOT in this response (it streams as binary from the
 * separate protocol endpoint); the FE collects the dispatched shipment ids from
 * `results` and requests the protocol over them.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BulkShipmentDispatchResult, PerOrderDispatchResult } from '@openlinker/core/shipping';
import { ShipmentResponseDto } from './shipment-response.dto';

export class PerOrderDispatchResultDto {
  @ApiProperty({ enum: ['dispatched', 'omp_fulfilled', 'failed'] })
  kind!: 'dispatched' | 'omp_fulfilled' | 'failed';

  @ApiProperty({ description: 'Internal order id (ol_order_*) this result is for' })
  orderId!: string;

  @ApiPropertyOptional({ type: ShipmentResponseDto, description: 'Present only when kind=dispatched' })
  shipment?: ShipmentResponseDto;

  @ApiPropertyOptional({ description: 'Present only when kind=failed — the rejection message' })
  error?: string;

  static fromResult(result: PerOrderDispatchResult): PerOrderDispatchResultDto {
    const dto = new PerOrderDispatchResultDto();
    dto.kind = result.kind;
    dto.orderId = result.orderId;
    if (result.kind === 'dispatched') {
      dto.shipment = ShipmentResponseDto.fromDomain(result.shipment);
    } else if (result.kind === 'failed') {
      dto.error = result.error;
    }
    return dto;
  }
}

export class BulkDispatchResultResponseDto {
  @ApiProperty({ type: [PerOrderDispatchResultDto] })
  results!: PerOrderDispatchResultDto[];

  static fromResult(result: BulkShipmentDispatchResult): BulkDispatchResultResponseDto {
    const dto = new BulkDispatchResultResponseDto();
    dto.results = result.results.map((r) => PerOrderDispatchResultDto.fromResult(r));
    return dto;
  }
}
