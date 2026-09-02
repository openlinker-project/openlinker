/**
 * Duplicate Positions Response DTO
 *
 * Transport shape for `GET /inventory/duplicate-positions` (#2319). Dates are
 * serialised to ISO strings at this boundary, matching the inventory-item
 * response DTO's idiom.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class DuplicatePositionRowResponseDto {
  @ApiProperty({ description: 'inventory_items primary key' })
  id!: string;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty()
  reservedQuantity!: number;

  @ApiProperty({
    description:
      'Stale rows are included: a stale duplicate still occupies the position key and would ' +
      'still collide under the unique index #2325 creates.',
  })
  isStale!: boolean;

  @ApiProperty({ description: 'ISO-8601 DB-stamped write time' })
  updatedAt!: string;
}

export class DuplicatePositionGroupResponseDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty({ nullable: true, type: String })
  productVariantId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  locationId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Connection provenance. Part of the grouping key: rows differing only in provenance are ' +
      'legitimate cross-source coexistence (ADR-058 decision 2), not duplicates. Null on rows ' +
      'not yet covered by the #2317 backfill.',
  })
  sourceConnectionId!: string | null;

  @ApiProperty({ description: 'Total rows on this position key (always > 1)' })
  rowCount!: number;

  @ApiProperty({ description: 'Rows on this key that are not stale' })
  liveRowCount!: number;

  @ApiProperty({ type: [DuplicatePositionRowResponseDto], description: 'Newest first' })
  rows!: DuplicatePositionRowResponseDto[];
}

export class DuplicatePositionsResponseDto {
  @ApiProperty({
    description:
      'UNCAPPED count of duplicate position groups across the whole table. 0 means the table ' +
      'is ready for the #2325 unique index; any other value means it is not.',
  })
  groupCount!: number;

  @ApiProperty({ description: 'UNCAPPED total rows across all duplicate groups' })
  rowCount!: number;

  @ApiProperty({
    description:
      'rowCount - groupCount: how many rows must be removed before the unique index can build ' +
      '(one row per group survives).',
  })
  excessRowCount!: number;

  @ApiProperty({ type: [DuplicatePositionGroupResponseDto] })
  groups!: DuplicatePositionGroupResponseDto[];

  @ApiProperty({ description: 'True when group detail was capped by maxGroups; totals never are' })
  truncated!: boolean;

  @ApiProperty({ description: 'ISO-8601 timestamp the scan was served at' })
  generatedAt!: string;
}
