/**
 * Saved View Request DTOs
 *
 * `class-validator` here is the fast, documented rejection for shape and
 * `pageKey`; the size limits and the definition's inner shape are enforced by
 * `SavedViewsService` (the browser is not the only way in, and the limits are
 * core rules). `definition` is a plain `@IsObject()` on purpose: the global
 * whitelist only strips undecorated properties of the DTO class, so nested
 * keys survive and the service validates them.
 *
 * @module apps/api/src/saved-views/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SAVED_VIEW_LIMITS, SavedViewScopeValues } from '@openlinker/core/saved-views';
import { SavedViewScope } from '@openlinker/core/saved-views';
import { SAVED_VIEW_PAGE_KEYS, SAVED_VIEW_PAGE_KEY_FORMAT } from '../../saved-view-page-keys';

const PAGE_KEY_DOC = {
  description: 'Opaque list-page key. Format ^[a-z][a-z0-9-]{1,63}$ and a registered page.',
  enum: SAVED_VIEW_PAGE_KEYS,
} as const;

export class ListSavedViewsQueryDto {
  @ApiProperty(PAGE_KEY_DOC)
  @IsString()
  @Matches(SAVED_VIEW_PAGE_KEY_FORMAT, { message: 'pageKey has an invalid format' })
  @IsIn(SAVED_VIEW_PAGE_KEYS, { message: 'pageKey is not a known list page' })
  pageKey!: string;
}

export class CreateSavedViewDto {
  @ApiProperty(PAGE_KEY_DOC)
  @IsString()
  @Matches(SAVED_VIEW_PAGE_KEY_FORMAT, { message: 'pageKey has an invalid format' })
  @IsIn(SAVED_VIEW_PAGE_KEYS, { message: 'pageKey is not a known list page' })
  pageKey!: string;

  @ApiProperty({ maxLength: SAVED_VIEW_LIMITS.nameChars })
  @IsString()
  @MinLength(1)
  @MaxLength(SAVED_VIEW_LIMITS.nameChars + 200)
  name!: string;

  @ApiProperty({ enum: SavedViewScopeValues })
  @IsIn(SavedViewScopeValues)
  scope!: SavedViewScope;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      '{ v, query, sort: {key, dir} | null, columns: string[], parts: Record<string, string[]>, pageSize? }. Limits: 16 KB, 64 columns, 2 KB query.',
  })
  @IsObject()
  definition!: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Admin only, shared views only: make this the default for users with no default of their own.',
  })
  @IsOptional()
  @IsBoolean()
  workspaceDefault?: boolean;
}

export class UpdateSavedViewDto {
  @ApiPropertyOptional({ maxLength: SAVED_VIEW_LIMITS.nameChars })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(SAVED_VIEW_LIMITS.nameChars + 200)
  name?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  definition?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Admin only, shared views only.' })
  @IsOptional()
  @IsBoolean()
  workspaceDefault?: boolean;

  @ApiProperty({
    description: 'The revision the client last read. A mismatch answers 409.',
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedRevision!: number;
}

export class SetDefaultSavedViewDto {
  @ApiProperty(PAGE_KEY_DOC)
  @IsString()
  @Matches(SAVED_VIEW_PAGE_KEY_FORMAT, { message: 'pageKey has an invalid format' })
  @IsIn(SAVED_VIEW_PAGE_KEYS, { message: 'pageKey is not a known list page' })
  pageKey!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The view to land on, or null for the system "All" view.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  viewId!: string | null;
}
