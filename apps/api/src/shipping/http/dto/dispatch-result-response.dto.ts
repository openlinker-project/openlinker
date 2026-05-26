/**
 * Dispatch Result Response DTO
 *
 * Response for POST /shipments/generate-label. Mirrors the core
 * `ShipmentDispatchResult` discriminated union: `dispatched` carries the
 * created/in-flight shipment; `omp_fulfilled` carries none (the OMP ships
 * externally — no OL label).
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ShipmentDispatchResult } from '@openlinker/core/shipping';
import { ShipmentResponseDto } from './shipment-response.dto';

export class DispatchResultResponseDto {
  @ApiProperty({ enum: ['dispatched', 'omp_fulfilled'] })
  kind!: 'dispatched' | 'omp_fulfilled';

  @ApiPropertyOptional({ type: ShipmentResponseDto, description: 'Present only when kind=dispatched' })
  shipment?: ShipmentResponseDto;

  static fromResult(result: ShipmentDispatchResult): DispatchResultResponseDto {
    const dto = new DispatchResultResponseDto();
    dto.kind = result.kind;
    if (result.kind === 'dispatched') {
      dto.shipment = ShipmentResponseDto.fromDomain(result.shipment);
    }
    return dto;
  }
}
