/**
 * Saved View Response DTO
 *
 * @module apps/api/src/saved-views/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { SavedViewReadModel } from '@openlinker/core/saved-views';

export class SavedViewResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() pageKey!: string;
  @ApiProperty({ enum: ['personal', 'shared'] }) scope!: 'personal' | 'shared';
  @ApiProperty() name!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) definition!: Record<string, unknown>;
  @ApiProperty({
    description:
      'True when the stored definition was not fully understood. It is still returned, coerced; never a 500.',
  })
  stale!: boolean;
  @ApiProperty() revision!: number;
  @ApiProperty({ type: String, nullable: true }) ownerUserId!: string | null;
  @ApiProperty({ type: String, nullable: true }) createdByUserId!: string | null;
  @ApiProperty() isWorkspaceDefault!: boolean;
  @ApiProperty({ description: 'The view the caller lands on, after the fallback chain.' })
  isDefault!: boolean;
  @ApiProperty({ description: 'May the caller edit or delete it.' }) canEdit!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static fromReadModel(view: SavedViewReadModel): SavedViewResponseDto {
    return {
      id: view.id,
      pageKey: view.pageKey,
      scope: view.scope,
      name: view.name,
      definition: { ...view.definition },
      stale: view.stale,
      revision: view.revision,
      ownerUserId: view.ownerUserId,
      createdByUserId: view.createdByUserId,
      isWorkspaceDefault: view.isWorkspaceDefault,
      isDefault: view.isDefault,
      canEdit: view.canEdit,
      createdAt: view.createdAt.toISOString(),
      updatedAt: view.updatedAt.toISOString(),
    };
  }
}
