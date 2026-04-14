/**
 * Paginated Webhook Deliveries Response DTO
 *
 * @module apps/api/src/webhooks/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { WebhookDeliverySummaryResponseDto } from './webhook-delivery-summary-response.dto';

export class PaginatedWebhookDeliveriesResponseDto {
  @ApiProperty({ type: [WebhookDeliverySummaryResponseDto] })
  items!: WebhookDeliverySummaryResponseDto[];

  @ApiProperty() total!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
}
