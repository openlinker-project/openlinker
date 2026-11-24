/**
 * Rewind Cursor DTOs (#4023)
 *
 * Request and response for POST /cursors/:connectionId/rewind. Only a named
 * target is accepted; a free-text value never is.
 *
 * @module apps/api/src/cursors/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CursorRewindTargetValues } from '@openlinker/core/sync';
import { CursorRewindTarget } from '@openlinker/core/sync';

export class RewindCursorDto {
  @ApiProperty({ example: 'master.product.sweep:connection:a1f3c2d0-6c7e-4b0a-9f21-3e8d5b7c1a90' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  cursorKey!: string;

  @ApiProperty({
    enum: CursorRewindTargetValues,
    description:
      '`restart-pass` drops an open catalogue pass so the next run starts a new one. `restart-check` puts a rolling re-check back at item 0.',
  })
  @IsIn(CursorRewindTargetValues)
  target!: CursorRewindTarget;
}

export class RewindCursorResponseDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty() cursorKey!: string;
  @ApiProperty({ nullable: true }) previousValue!: string | null;
  @ApiProperty() value!: string;
}
