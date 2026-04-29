/**
 * Retry Order Destination Response DTO
 *
 * Response shape for `POST /orders/:internalOrderId/destinations/:connectionId/retry`.
 * Returns the new sync-job id created for the retry so the FE can deep-link
 * into `/sync/jobs/:id` if the operator wants to follow the retry.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class RetryOrderDestinationResponseDto {
  @ApiProperty({
    description: 'Internal order id the retry was issued for',
    example: 'ol_order_abc123',
  })
  internalOrderId!: string;

  @ApiProperty({
    description: 'Destination connection id whose row was retried',
    example: '0aa1c2e0-1234-4abc-8def-0123456789ab',
  })
  destinationConnectionId!: string;

  @ApiProperty({
    description: 'Newly enqueued sync-job id',
    example: '7f0a89c2-9f33-4d51-8cce-7a37a9c45d11',
  })
  jobId!: string;

  @ApiProperty({
    description: 'Job type — always `marketplace.order.sync` for now',
    example: 'marketplace.order.sync',
  })
  jobType!: string;
}
