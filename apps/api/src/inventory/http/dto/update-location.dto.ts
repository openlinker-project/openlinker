/**
 * Update Inventory Location DTO
 *
 * Request body for PATCH /inventory/locations/:id (#2316). Mirrors
 * `UpdateInventoryLocationInput`: every field optional, an omitted field left
 * untouched, an explicit `null` clearing a nullable column.
 *
 * **`code` is deliberately absent.** It is the row's operator-facing natural key
 * and `inventory_items.locationId` semantics reference it, so renaming it is not
 * a patch-shaped operation. Because the global `ValidationPipe` runs with
 * `forbidNonWhitelisted`, sending `code` here is a 400 rather than a silently
 * ignored field — which is the behaviour we want, and the int-spec asserts it.
 *
 * **`@IsOptional()` skips `null` as well as `undefined`**, which is exactly
 * right for the nullable-clearing fields and exactly WRONG for `name` / `kind` /
 * `status`: those columns are NOT NULL, so an explicit `null` would sail past
 * validation and surface as a 500 from the driver. Those three therefore use
 * `@ValidateIf((_o, v) => v !== undefined)` — the house value-arg form — so an
 * omitted field is skipped but an explicit `null` is validated and rejected 400.
 *
 * @module apps/api/src/inventory/http/dto
 */
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  InventoryLocationKindValues,
  InventoryLocationStatusValues,
  type InventoryLocationKind,
  type InventoryLocationStatus,
} from '@openlinker/core/inventory';

export class UpdateLocationDto {
  @ApiPropertyOptional({ description: 'Human-readable name. Cannot be cleared.' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: InventoryLocationKindValues })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(InventoryLocationKindValues)
  kind?: InventoryLocationKind;

  @ApiPropertyOptional({ nullable: true, description: 'Provenance only, never authority.' })
  @IsOptional()
  // @IsUUID, not @IsString: the column is `uuid` and carries a live FK. A
  // well-formed-but-non-uuid string reaches the driver as a cast error (500)
  // on what is really malformed input, so the shape is rejected here (400).
  // A syntactically valid id naming no connection is a different failure and
  // is translated from 23503 in LocationRepository (422).
  @IsUUID()
  ownerConnectionId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalRef?: string | null;

  @ApiPropertyOptional({ enum: InventoryLocationStatusValues })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(InventoryLocationStatusValues)
  status?: InventoryLocationStatus;

  @ApiPropertyOptional({ nullable: true, description: 'ISO-3166-1 alpha-2' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryIso2?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  // Matches the varchar(16) column exactly; a wider bound here turns an
  // over-long postcode into a driver error (500) instead of a 400.
  @MaxLength(16)
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
