/**
 * Discard Content Draft DTO
 *
 * Request body for `POST /products/:id/content/discard`. Identifies a single
 * content field row by `(connectionId, fieldKey)` and clears its draft value.
 *
 * @module apps/api/src/content/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { FieldKeyValues, type FieldKey } from '@openlinker/core/content';

export class DiscardContentDraftDto {
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsUUID()
  connectionId!: string | null;

  @ApiProperty({ enum: FieldKeyValues })
  @IsIn(FieldKeyValues as unknown as string[])
  fieldKey!: FieldKey;
}
