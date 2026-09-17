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
      '(sourceConnectionId IS NULL). Resolved LIVE on every call, never cached — the ' +
      'backfill scans by predicate rather than a scan offset, so there is no cached ' +
      'answer for a stale offset to protect; reading live is what stays correct even ' +
      'after the pass has latched (see latchedAt).',
  })
  remainingNull!: number;

  @ApiProperty({ description: 'remainingNull === 0' })
  completed!: boolean;

  @ApiProperty({
    description:
      "The backfill's own persisted completion stamp (ISO timestamp), or null if it has " +
      'never latched. Non-null while remainingNull > 0 means the pass has stopped ' +
      'running on its own — a later mutation reintroduced a NULL row after completion — ' +
      'and needs to be re-armed (delete the connection_cursors row; see ' +
      'InventoryProvenanceBackfillHandler).',
    nullable: true,
  })
  latchedAt!: string | null;
}
