/**
 * Retry Order Routing Response DTO (#3558)
 *
 * Response shape for `POST /orders/:internalOrderId/retry-routing`. The route
 * job is only ENQUEUED: the outcome shows up on the order itself (the
 * "Waiting: ..." badge clears, or its detail changes), the way every other retry
 * in this API reports.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class RetryOrderRoutingResponseDto {
  @ApiProperty({
    description: 'Internal order id routing was retried for',
    example: 'ol_order_abc123',
  })
  internalOrderId!: string;

  @ApiProperty({
    description: 'Newly enqueued `fulfillment.work.route` job id',
    example: '7f0a89c2-9f33-4d51-8cce-7a37a9c45d11',
  })
  jobId!: string;
}
