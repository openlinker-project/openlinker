/**
 * Webhook Request DTO
 *
 * Data transfer object for inbound webhook requests. Defines the structure
 * and validation rules for webhook payloads from external systems (e.g., PrestaShop).
 *
 * @module apps/api/src/webhooks/http/dto
 */
import {
  IsString,
  IsNumber,
  IsObject,
  IsOptional,
  IsNotEmpty,
  ValidateNested,
  Min,
  Matches,
  IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Object reference in webhook payload
 */
export class WebhookObjectDto {
  @ApiProperty({ description: 'Object type (e.g., "product", "order", "stock")' })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ description: 'External object identifier' })
  @IsString()
  @IsNotEmpty()
  externalId!: string;
}

/**
 * Webhook Request DTO
 *
 * Structure for inbound webhook requests. All fields are validated using
 * class-validator decorators.
 */
export class WebhookRequestDto {
  @ApiProperty({ description: 'Schema version (start with 1)', example: 1 })
  @IsNumber()
  @Min(1)
  schemaVersion!: number;

  @ApiProperty({ description: 'Unique event identifier (UUID or deterministic)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'eventId must contain only alphanumeric characters, hyphens, and underscores',
  })
  eventId!: string;

  @ApiProperty({
    description: 'Event type (e.g., "product.saved", "stock.changed", "order.created", "order.status_changed")',
    example: 'product.saved',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z]+\.[a-z_]+$/, {
    message: 'eventType must be in format "category.action" (lowercase, dot-separated)',
  })
  eventType!: string;

  @ApiProperty({ description: 'ISO 8601 timestamp when the event occurred' })
  @IsString()
  @IsNotEmpty()
  @IsISO8601({ strict: true }, { message: 'occurredAt must be a valid ISO 8601 timestamp' })
  occurredAt!: string;

  @ApiProperty({ description: 'Object reference', type: WebhookObjectDto })
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookObjectDto)
  @IsNotEmpty()
  object!: WebhookObjectDto;

  @ApiPropertyOptional({ description: 'Optional payload data' })
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;
}

