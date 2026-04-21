/**
 * Create Offer Response DTO
 *
 * Response shape for `POST /listings/connections/:connectionId/offers` (202).
 * Exposes both the enqueued job id and the pre-created OfferCreationRecord id
 * so clients can poll the GET status endpoint without waiting for the worker.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class CreateOfferResponseDto {
  @ApiProperty({ description: 'Redis Streams message id of the enqueued marketplace.offer.create job' })
  jobId!: string;

  @ApiProperty({
    description:
      'Id of the OfferCreationRecord created synchronously with status=pending. Use this to poll GET /listings/connections/:connectionId/offers/creation/:id.',
  })
  offerCreationRecordId!: string;
}
