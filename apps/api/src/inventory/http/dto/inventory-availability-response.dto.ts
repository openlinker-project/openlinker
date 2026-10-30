/**
 * Inventory Availability Response DTO
 *
 * Response shape for `GET /inventory/availability` (#792 PR 2). One item
 * per requested variant ID; zero-filled when the variant has no inventory
 * rows.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class InventoryAvailabilityItemDto {
  @ApiProperty({ description: 'Internal product-variant ID' })
  productVariantId!: string;

  @ApiProperty({
    description: 'Summed availableQuantity across all locations (0 when no inventory rows)',
  })
  totalAvailable!: number;

  @ApiProperty({
    description: 'Distinct location count contributing to the sum (0 when no inventory rows)',
  })
  locationCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Units OpenLinker will promise (#2323): totalAvailable net of OpenLinker’s own ' +
      'published reservations, answered in the GLOBAL scope with NO per-destination stock safety buffer applied. ' +
      'null means availability could not be determined — never "zero", and never a ' +
      'reason to fall back to totalAvailable.',
  })
  availableToPromise!: number | null;

  @ApiProperty({
    enum: ['computed', 'authority', 'unknown'],
    description:
      'Where availableToPromise came from (#3621). `unknown` is paired with a null availableToPromise and ' +
      'null heldCounted / heldRecordedOnly. The answer is in the GLOBAL scope: NO per-channel buffer or zero ' +
      'threshold is applied; a channel figure is on GET /inventory/stock-view.',
  })
  provenance!: 'computed' | 'authority' | 'unknown';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Newest stock write across the variant\'s live positions (ISO 8601); null when it has none (#3621).',
  })
  observedAt!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Age of observedAt in milliseconds at response time; null when observedAt is null (#3621).',
  })
  stalenessMs!: number | null;

  @ApiProperty({
    type: Boolean,
    description:
      'stalenessMs exceeds the operator-set stale-sync threshold (Operational Settings, default 6 h). False when staleness is unknown (#3621).',
  })
  isStaleSync!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Held units NOT reflected in availableToPromise (authority answers only); null on the computed path (#3621).',
  })
  olHeldNotReflected!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Units OpenLinker has promised that REDUCE availableToPromise (advisory holds stamped `published`). null = unknown, never 0 (#3621).',
  })
  heldCounted!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Units OpenLinker has recorded that restrict nothing (holds stamped `diagnostic`). null = unknown, never 0 (#3621).',
  })
  heldRecordedOnly!: number | null;

  @ApiProperty({
    description:
      'Number of LIVE positions behind the variant. More than 1 means several locations and/or masters contribute (#3621).',
  })
  livePositionCount!: number;
}

export class InventoryAvailabilityResponseDto {
  @ApiProperty({ type: [InventoryAvailabilityItemDto] })
  items!: InventoryAvailabilityItemDto[];
}
