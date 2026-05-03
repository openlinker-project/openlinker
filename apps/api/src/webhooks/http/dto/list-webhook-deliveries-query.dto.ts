/**
 * List Webhook Deliveries Query DTO
 *
 * Query parameters for GET /webhook-deliveries.
 *
 * @module apps/api/src/webhooks/http/dto
 */
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  WebhookDeliveryStatus,
  WebhookDeliveryStatusValues,
} from '@openlinker/core/webhooks';

export class ListWebhookDeliveriesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by webhook provider (e.g. prestashop)' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Filter by connection ID (UUID)' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({ description: 'Filter by event type (e.g. test.ping, actionProductSave)' })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({ enum: WebhookDeliveryStatusValues, description: 'Filter by delivery status' })
  @IsOptional()
  @IsEnum(WebhookDeliveryStatusValues)
  status?: WebhookDeliveryStatus;

  @ApiPropertyOptional({ description: 'Inclusive lower bound for receivedAt (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  since?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound for receivedAt (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  until?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
