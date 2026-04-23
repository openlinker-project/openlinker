/**
 * Save Content Draft DTO
 *
 * Request body for `POST /products/:id/content/draft`. `connectionId` is
 * `null` for the master row, a UUID for a channel override. `fieldKey`
 * accepts the seeded content field union ("description" today) — validated
 * against the `FieldKey` values in the core content context.
 *
 * @module apps/api/src/content/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FieldKeyValues, type FieldKey } from '@openlinker/core/content';

export class SaveContentDraftDto {
  @ApiProperty({
    nullable: true,
    description: 'null for the master row; UUID for a channel override.',
  })
  @IsOptional()
  @IsUUID()
  connectionId!: string | null;

  @ApiProperty({ enum: FieldKeyValues })
  @IsIn(FieldKeyValues as unknown as string[])
  fieldKey!: FieldKey;

  @ApiProperty({ maxLength: 65536 })
  @IsString()
  @MaxLength(65536)
  value!: string;
}
