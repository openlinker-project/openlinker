/**
 * Upload Safety Attachment Response DTO
 *
 * Returned by `POST /integrations/allegro/connections/:id/safety-attachments`
 * after a single PDF upload. Only `id` flows back to Allegro on offer
 * create — the other fields are echoed so the FE can render the
 * uploaded item in the connection-edit wizard's attachment list
 * without re-fetching.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class UploadSafetyAttachmentResponseDto {
  @ApiProperty({ description: 'Allegro attachment id (referenced from safetyInformation.attachments[].id on offer create)' })
  id!: string;

  @ApiProperty({ description: 'Original file name supplied by the operator' })
  fileName!: string;

  @ApiProperty({ description: 'MIME type of the uploaded file' })
  mimeType!: string;

  @ApiProperty({ description: 'Size of the uploaded file in bytes' })
  sizeBytes!: number;

  @ApiProperty({ description: 'ISO 8601 timestamp when the upload completed' })
  uploadedAt!: string;
}
