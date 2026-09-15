/**
 * Provenance Backfill Status Response DTO
 *
 * Transport shape for `GET /inventory/provenance-backfill-status` (#3240) —
 * the second, independent readiness condition for the #2325 migration
 * alongside `GET /inventory/duplicate-positions`'s `groupCount`.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class ProvenanceBackfillStatusResponseDto {
  @ApiProperty({
    description:
      'UNCAPPED count of inventory_items rows still missing #2317 provenance ' +
      '(sourceConnectionId IS NULL). Resolved LIVE on every call, never cached — the backfill ' +
      'itself tracks no cursor, so a stored answer here could go stale the moment a later ' +
      'mutation reintroduces a NULL row.',
  })
  remainingNull!: number;

  @ApiProperty({ description: 'remainingNull === 0' })
  completed!: boolean;
}
