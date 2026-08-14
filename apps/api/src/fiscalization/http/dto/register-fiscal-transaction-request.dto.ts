/**
 * Register Fiscal Transaction Request DTO (#1908)
 *
 * Body for `POST /fiscal-registrations`. The client supplies ONLY the connection,
 * the order and an optional exactly-once key - never the lines. The controller
 * composes the whole command server-side from the order snapshot.
 *
 * Neutral by contract (ADR-042 decision 4): no country, regime or vendor
 * vocabulary reaches the API surface either.
 *
 * @module apps/api/src/fiscalization/http/dto
 */
import { IsString, IsNotEmpty, IsUUID, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterFiscalTransactionRequestDto {
  @ApiProperty({ description: 'Fiscalization connection id' })
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ description: 'Internal order id whose sale should be registered' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiPropertyOptional({
    description:
      'Caller-controlled exactly-once key. Omit to use the deterministic per-(connection, order) ' +
      'default, which makes a repeated request idempotent by construction - a double click cannot ' +
      'produce a second registration.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  idempotencyKey?: string;
}
