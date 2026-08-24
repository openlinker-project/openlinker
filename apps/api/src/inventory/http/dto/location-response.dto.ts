/**
 * Inventory Location Response DTO
 *
 * Explicit allowlist projection of `InventoryLocation` (#2316). Every field is
 * enumerated rather than spread, so a column added to the domain entity later
 * cannot start leaking through this surface unnoticed.
 *
 * Dates are ISO strings, mapped in the controller (the `InventoryController`
 * idiom) rather than by a DTO transform.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  InventoryLocationKindValues,
  InventoryLocationStatusValues,
  type InventoryLocationKind,
  type InventoryLocationStatus,
} from '@openlinker/core/inventory';

export class LocationResponseDto {
  @ApiProperty({ description: 'OL-owned `ol_location_*` id' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: InventoryLocationKindValues })
  kind!: InventoryLocationKind;

  @ApiProperty({ nullable: true, type: String })
  ownerConnectionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  externalRef!: string | null;

  @ApiProperty({ enum: InventoryLocationStatusValues })
  status!: InventoryLocationStatus;

  @ApiProperty({ nullable: true, type: String })
  countryIso2!: string | null;

  @ApiProperty({ nullable: true, type: String })
  postcode!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  latitude!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  longitude!: number | null;

  @ApiProperty({ description: 'ISO-8601' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO-8601' })
  updatedAt!: string;
}
