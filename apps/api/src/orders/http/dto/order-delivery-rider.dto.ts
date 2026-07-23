/**
 * Order Delivery Rider DTO
 *
 * Read-only projection (#1792, epic #1776) of the actionable delivery hint for a
 * `default`-resolved order, surfaced next to #1791's `deliveryResolution` so the
 * FE consumes both together. Maps the order's raw source delivery method to a
 * candidate carrier and reports whether the operator should *Add mapping*
 * (`unmapped`), *Connect* the carrier (`not-connected`), or see nothing
 * (`none`). Never influences routing — a pure derived read.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryRider, DeliveryRiderValues } from '@openlinker/core/mappings';

class DeliveryRiderCandidateCarrierDto {
  @ApiProperty({
    description:
      "The candidate carrier's platformType (matches the carrier adapter manifest, e.g. \"inpost\", \"dpd\").",
  })
  platformType!: string;

  @ApiProperty({
    description: 'Canonical carrier label for the fix-it button (e.g. "InPost", "DPD").',
  })
  displayName!: string;
}

export class OrderDeliveryRiderDto {
  @ApiProperty({
    enum: DeliveryRiderValues,
    description:
      '"unmapped" (a supported carrier is connected → Add mapping), "not-connected" (OL supports the ' +
      'carrier but none is connected → Connect), or "none" (no carrier match, a non-default resolution, ' +
      'or a carrier OL cannot handle → show nothing). Only fires on a "default" resolution.',
  })
  rider!: DeliveryRider;

  @ApiPropertyOptional({
    type: DeliveryRiderCandidateCarrierDto,
    description:
      'The heuristic-matched candidate carrier. Present only for the actionable riders ' +
      '("unmapped" / "not-connected"); absent for "none".',
  })
  candidateCarrier?: DeliveryRiderCandidateCarrierDto;
}
