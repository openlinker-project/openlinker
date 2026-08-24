/**
 * Create Inventory Location DTO
 *
 * Request body for POST /inventory/locations (#2316). Mirrors
 * `CreateInventoryLocationInput`.
 *
 * The `kind` / `status` validators reuse the core `as const` tuples rather than
 * re-spelling the members, so a value added in the domain cannot silently be
 * rejected here.
 *
 * Geo arrives as JSON numbers, so there is no `@Type(() => Number)` — that
 * coercion belongs on query DTOs, where every value is a string.
 *
 * `code` and `countryIso2` are deliberately NOT normalised here: the
 * application service owns the single normalisation point for the
 * case-sensitive unique index, and doing it twice invites the two to drift.
 *
 * @module apps/api/src/inventory/http/dto
 */
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InventoryLocationKindValues,
  InventoryLocationStatusValues,
  type InventoryLocationKind,
  type InventoryLocationStatus,
} from '@openlinker/core/inventory';

export class CreateLocationDto {
  @ApiProperty({
    description:
      'Operator-facing natural key, unique across the install. Normalised (trimmed + uppercased) by the application service.',
    example: 'WH1',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ description: 'Human-readable name', example: 'Main warehouse' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: InventoryLocationKindValues, description: 'What the location physically is' })
  @IsIn(InventoryLocationKindValues)
  kind!: InventoryLocationKind;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Provenance only — whose sync may write positions here. Never authority (ADR-052).',
  })
  @IsOptional()
  @IsString()
  ownerConnectionId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Free-text operator reference. NOT an identifier mapping.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalRef?: string | null;

  @ApiPropertyOptional({ enum: InventoryLocationStatusValues, default: 'active' })
  @IsOptional()
  @IsIn(InventoryLocationStatusValues)
  status?: InventoryLocationStatus;

  @ApiPropertyOptional({ nullable: true, description: 'ISO-3166-1 alpha-2', example: 'PL' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryIso2?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '00-001' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  postcode?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}
