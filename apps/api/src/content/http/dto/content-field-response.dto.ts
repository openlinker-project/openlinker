/**
 * Content Field Response DTO
 *
 * Wire shape for the single row returned by `POST /draft` / `/publish`.
 * Reuses the master-state shape minus the state-card composition.
 *
 * @module apps/api/src/content/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { ProductContentField } from '@openlinker/core/content';

export class ContentFieldResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() productId!: string;
  @ApiProperty({ nullable: true }) connectionId!: string | null;
  @ApiProperty() fieldKey!: string;
  @ApiProperty({ nullable: true }) draftValue!: string | null;
  @ApiProperty({ nullable: true }) baseValue!: string | null;
  @ApiProperty({ nullable: true }) baseVersion!: string | null;
  @ApiProperty() hasConflict!: boolean;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ nullable: true }) updatedBy!: string | null;

  static fromDomain(row: ProductContentField): ContentFieldResponseDto {
    const dto = new ContentFieldResponseDto();
    dto.id = row.id;
    dto.productId = row.productId;
    dto.connectionId = row.connectionId;
    dto.fieldKey = row.fieldKey;
    dto.draftValue = row.draftValue;
    dto.baseValue = row.baseValue;
    dto.baseVersion = row.baseVersion;
    dto.hasConflict = row.hasConflict;
    dto.updatedAt = row.updatedAt.toISOString();
    dto.updatedBy = row.updatedBy;
    return dto;
  }
}
