/**
 * Publish Content DTO
 *
 * Request body for `POST /products/:id/content/publish`. Same shape as the
 * discard DTO — the row is identified by `(connectionId, fieldKey)` and the
 * existing draft on that row is pushed through to the platform via
 * `ContentPublisherPort`.
 *
 * @module apps/api/src/content/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { FieldKeyValues, type FieldKey } from '@openlinker/core/content';

export class PublishContentDto {
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsUUID()
  connectionId!: string | null;

  @ApiProperty({ enum: FieldKeyValues })
  @IsIn(FieldKeyValues as unknown as string[])
  fieldKey!: FieldKey;
}
