/**
 * Customer Address Response DTO
 *
 * Response shape for a single customer address projection.
 * Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/customers/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerAddressResponseDto {
  @ApiProperty({ description: 'Address hash fingerprint' })
  addressHash!: string;

  @ApiProperty({ description: 'Address type', enum: ['shipping', 'billing'] })
  addressType!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Address line 1' })
  address1!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Address line 2' })
  address2!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'City' })
  city!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Postal code' })
  postcode!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Country ISO 2 code' })
  countryIso2!: string | null;

  @ApiProperty({ description: 'Last seen timestamp (ISO 8601)' })
  lastSeenAt!: string;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;
}
