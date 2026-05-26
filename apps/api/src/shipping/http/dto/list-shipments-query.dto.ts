/**
 * List Shipments Query DTO
 *
 * Query parameters for GET /shipments. All fields optional.
 *
 * NOTE on coercion: query params arrive as strings. `hasTracking` uses an
 * explicit `@Transform` ('true'/'false' → boolean) — NOT `@Type(() => Boolean)`,
 * which would coerce `"false"` to `true`. Date bounds validate the raw ISO
 * string via `@IsDateString` and are converted to `Date` in the controller —
 * NOT `@Type(() => Date)`, which would hand `@IsDateString` a `Date` object.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ShipmentStatusValues,
  ShippingMethodValues,
  type ShipmentStatus,
  type ShippingMethod,
} from '@openlinker/core/shipping';

export class ListShipmentsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by internal order id (ol_order_*)' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ enum: ShipmentStatusValues, description: 'Filter by shipment status' })
  @IsOptional()
  @IsEnum(ShipmentStatusValues)
  status?: ShipmentStatus;

  @ApiPropertyOptional({ description: 'Filter by shipping-provider connection id (UUID)' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({ enum: ShippingMethodValues, description: 'Filter by shipping method' })
  @IsOptional()
  @IsEnum(ShippingMethodValues)
  shippingMethod?: ShippingMethod;

  @ApiPropertyOptional({
    description: 'true → only shipments with a tracking number; false → only those without',
  })
  @IsOptional()
  @Transform(({ value }): unknown =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  hasTracking?: boolean;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on createdAt (ISO-8601)' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on createdAt (ISO-8601)' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
