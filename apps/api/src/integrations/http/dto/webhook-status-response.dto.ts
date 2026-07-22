/**
 * Webhook Status Response DTO
 *
 * Body for `GET /connections/:id/webhooks/status` (#1770) — the operator-facing
 * activation + signature state and the latest delivery summary.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { WebhookStatus } from '../../application/types/webhook-status.types';
import {
  WebhookActivationValues,
  WebhookSignatureStateValues,
  type WebhookActivation,
  type WebhookSignatureState,
} from '../../application/types/webhook-status.types';

export class WebhookStatusResponseDto {
  @ApiProperty({ enum: WebhookActivationValues })
  activation!: WebhookActivation;

  @ApiProperty({ enum: WebhookSignatureStateValues })
  signature!: WebhookSignatureState;

  @ApiProperty({ type: String, nullable: true })
  lastDeliveryAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastDeliveryEvent!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastDeliveryResult!: string | null;

  static fromDomain(status: WebhookStatus): WebhookStatusResponseDto {
    const dto = new WebhookStatusResponseDto();
    dto.activation = status.activation;
    dto.signature = status.signature;
    dto.lastDeliveryAt = status.lastDeliveryAt;
    dto.lastDeliveryEvent = status.lastDeliveryEvent;
    dto.lastDeliveryResult = status.lastDeliveryResult;
    return dto;
  }
}
