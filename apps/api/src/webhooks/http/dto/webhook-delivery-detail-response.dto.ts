/**
 * Webhook Delivery Detail Response DTO
 *
 * Detail-view shape — includes the full raw payload for troubleshooting.
 *
 * @module apps/api/src/webhooks/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookDeliverySummaryResponseDto } from './webhook-delivery-summary-response.dto';

export class WebhookDeliveryDetailResponseDto extends WebhookDeliverySummaryResponseDto {
  @ApiPropertyOptional({ nullable: true, description: 'Raw webhook payload' })
  payload!: Record<string, unknown> | null;
}
