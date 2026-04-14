/**
 * Webhook Delivery Summary Response DTO
 *
 * List-view shape — excludes the full payload to avoid leaking PII in list
 * responses. Use the detail endpoint for the full payload.
 *
 * @module apps/api/src/webhooks/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookDeliveryStatusValues } from '@openlinker/core/webhooks';

export class WebhookDeliverySummaryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() connectionId!: string;
  @ApiPropertyOptional({ nullable: true }) eventType!: string | null;
  @ApiPropertyOptional({ nullable: true }) objectType!: string | null;
  @ApiPropertyOptional({ nullable: true }) externalId!: string | null;
  @ApiProperty({ description: 'ISO 8601 timestamp' }) receivedAt!: string;
  @ApiPropertyOptional({ nullable: true }) signatureValid!: boolean | null;
  @ApiPropertyOptional({ nullable: true }) dedupResult!: string | null;
  @ApiProperty({ enum: WebhookDeliveryStatusValues }) status!: string;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) publishedMessageId!: string | null;
  @ApiPropertyOptional({ nullable: true }) downstreamJobId!: string | null;
  @ApiPropertyOptional({ nullable: true }) downstreamJobType!: string | null;
  @ApiPropertyOptional({ nullable: true }) dlqReason!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
