/**
 * Release State DTOs
 *
 * Request bodies are explicit allow-lists: a `userId` in a body is not a
 * property here, and the global ValidationPipe whitelist drops it, so the user
 * id can only come from the token (ADR-086).
 *
 * @module apps/api/src/release-center/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  InstallationItemStatusValues,
  RELEASE_ITEM_KEY_PATTERN,
  RELEASE_STATE_BATCH_MAX,
  ReleaseDoneViaValues,
  UserItemStatusValues,
  type ReleaseItemState,
  type UserReleaseState,
} from '@openlinker/core/release-center';

const VERSION_PATTERN = /^v?\d{1,6}\.\d{1,6}\.\d{1,6}(-(alpha|beta|rc)\.\d{1,6})?$/;

export class UpdateReleaseCursorDto {
  @ApiPropertyOptional({ example: '0.20.0' })
  @IsOptional()
  @IsString()
  @Matches(VERSION_PATTERN, { message: 'version must be a release version' })
  version?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  skipDialog?: boolean;
}

abstract class ReleaseItemChangeBaseDto {
  @ApiProperty({ example: 'carrier-mapping:3f2a1c9e-0000-4000-8000-000000000000' })
  @IsString()
  @Matches(RELEASE_ITEM_KEY_PATTERN, { message: 'itemKey has an invalid format' })
  itemKey!: string;

  @ApiPropertyOptional({ enum: ReleaseDoneViaValues, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(ReleaseDoneViaValues)
  doneVia?: (typeof ReleaseDoneViaValues)[number] | null;
}

export class UserReleaseItemChangeDto extends ReleaseItemChangeBaseDto {
  @ApiProperty({ enum: UserItemStatusValues })
  @IsIn(UserItemStatusValues)
  status!: (typeof UserItemStatusValues)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  snoozedUntil?: string | null;
}

export class InstallationReleaseItemChangeDto extends ReleaseItemChangeBaseDto {
  @ApiProperty({ enum: InstallationItemStatusValues })
  @IsIn(InstallationItemStatusValues)
  status!: (typeof InstallationItemStatusValues)[number];
}

export class UpdateUserReleaseItemsDto {
  @ApiProperty({ type: [UserReleaseItemChangeDto], maxItems: RELEASE_STATE_BATCH_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RELEASE_STATE_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => UserReleaseItemChangeDto)
  changes!: UserReleaseItemChangeDto[];
}

export class UpdateInstallationReleaseStepsDto {
  @ApiProperty({ type: [InstallationReleaseItemChangeDto], maxItems: RELEASE_STATE_BATCH_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RELEASE_STATE_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => InstallationReleaseItemChangeDto)
  changes!: InstallationReleaseItemChangeDto[];
}

export class ReleaseCursorResponseDto {
  @ApiProperty({ nullable: true })
  lastSeenVersion!: string | null;

  @ApiProperty()
  skipDialog!: boolean;

  @ApiProperty()
  updatedAt!: string;

  static from(state: UserReleaseState | null): ReleaseCursorResponseDto | null {
    if (!state) return null;
    return {
      lastSeenVersion: state.version?.text ?? null,
      skipDialog: state.skipDialog,
      updatedAt: state.updatedAt.toISOString(),
    };
  }
}

export class ReleaseItemStateResponseDto {
  @ApiProperty()
  itemKey!: string;

  @ApiProperty()
  scope!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ nullable: true })
  doneVia!: string | null;

  @ApiProperty({ nullable: true })
  snoozedUntil!: string | null;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional({ description: 'Present for admins only' })
  actedByUserId?: string | null;

  /** `actedByUserId` is attributed staff data: only an admin receives it. */
  static from(state: ReleaseItemState, includeActor: boolean): ReleaseItemStateResponseDto {
    const dto: ReleaseItemStateResponseDto = {
      itemKey: state.itemKey,
      scope: state.scope,
      status: state.status,
      doneVia: state.doneVia,
      snoozedUntil: state.snoozedUntil ? state.snoozedUntil.toISOString() : null,
      updatedAt: state.updatedAt.toISOString(),
    };
    if (includeActor) dto.actedByUserId = state.actedByUserId;
    return dto;
  }
}

export class ReleaseStateResponseDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: ReleaseCursorResponseDto, nullable: true })
  cursor!: ReleaseCursorResponseDto | null;

  @ApiProperty({ type: [ReleaseItemStateResponseDto] })
  user!: ReleaseItemStateResponseDto[];

  @ApiProperty({ type: [ReleaseItemStateResponseDto] })
  installation!: ReleaseItemStateResponseDto[];
}

export class UpdateReleaseCursorResponseDto {
  @ApiProperty({ description: 'False when the version was older than the stored cursor' })
  applied!: boolean;

  @ApiProperty({ type: ReleaseCursorResponseDto, nullable: true })
  cursor!: ReleaseCursorResponseDto | null;
}

export class ReleaseItemStatesResponseDto {
  @ApiProperty({ type: [ReleaseItemStateResponseDto] })
  items!: ReleaseItemStateResponseDto[];
}
