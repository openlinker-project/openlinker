/**
 * Customer Projection Response DTO
 *
 * Response shape for a single customer projection.
 * Dates are serialised as ISO 8601 strings. PII fields may be null
 * if OL_STORE_PII is disabled.
 *
 * @module apps/api/src/customers/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerAddressResponseDto } from './customer-address-response.dto';

export class CustomerProjectionResponseDto {
  @ApiProperty({ description: 'Internal customer ID (e.g. ol_customer_...)' })
  internalCustomerId!: string;

  @ApiProperty({ description: 'Email hash (always present)' })
  emailHash!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Normalized email (null if PII storage disabled)' })
  normalizedEmail!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'First name (null if PII storage disabled)' })
  firstName!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Last name (null if PII storage disabled)' })
  lastName!: string | null;

  @ApiProperty({ description: 'Last seen timestamp (ISO 8601)' })
  lastSeenAt!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Last source connection ID' })
  lastSourceConnectionId!: string | null;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: [CustomerAddressResponseDto], description: 'Customer addresses (detail only)' })
  addresses?: CustomerAddressResponseDto[];
}
