/**
 * Pickup-Point Response DTO
 *
 * HTTP projection of the `PickupPoint` domain value (#766). Exposes the full
 * provider-side metadata the picker (#769) renders: address, availability
 * status, geo, and the structured 7-day opening-hours grid.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PickupPointStatusValues,
  type PickupPoint,
  type PickupPointAddress,
  type PickupPointOpeningHours,
  type PickupPointStatus,
} from '@openlinker/core/shipping';

class PickupPointAddressDto implements PickupPointAddress {
  @ApiProperty() line1!: string;
  @ApiPropertyOptional() line2?: string;
  @ApiProperty() city!: string;
  @ApiProperty() postalCode!: string;
  @ApiProperty() country!: string;
}

export class PickupPointResponseDto {
  @ApiProperty({ description: 'Provider-issued pickup-point id (e.g. POZ08A)' })
  providerId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: PickupPointAddressDto })
  address!: PickupPointAddressDto;

  @ApiProperty({ enum: PickupPointStatusValues, description: 'Availability status' })
  status!: PickupPointStatus;

  @ApiPropertyOptional({ description: 'Latitude (WGS84)' })
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitude (WGS84)' })
  lon?: number;

  @ApiPropertyOptional({
    description: 'Structured 7-day opening-hours grid in the provider-local timezone',
  })
  openingHours?: PickupPointOpeningHours;

  static fromDomain(point: PickupPoint): PickupPointResponseDto {
    const dto = new PickupPointResponseDto();
    dto.providerId = point.providerId;
    dto.name = point.name;
    dto.address = { ...point.address };
    dto.status = point.status;
    dto.lat = point.lat;
    dto.lon = point.lon;
    dto.openingHours = point.openingHours;
    return dto;
  }
}
