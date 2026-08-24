/**
 * Catalog Trust Response DTO
 *
 * Response shape for GET /connections/:connectionId/catalog-trust (#2258).
 *
 * @module apps/api/src/catalog-trust/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { MasterCatalogRungValues, MasterCatalogRung } from '@openlinker/core/catalog-trust';

export class CatalogTrustResponseDto {
  @ApiProperty({ description: 'Connection id' })
  connectionId!: string;

  @ApiProperty({
    enum: MasterCatalogRungValues,
    description:
      "The capability rung the connection's ProductMaster adapter declares, in capability terms: " +
      "'modified-since' (declares ModifiedProductLister), 'full-enumeration' (base rung — every " +
      "scheduled sync re-reads the whole catalog), or 'unknown' (the adapter could not be resolved).",
  })
  rung!: MasterCatalogRung;

  @ApiProperty({
    description:
      'Whether the deployment-wide delta scheduler task (master.product.syncDelta) is currently ' +
      "enabled. A 'modified-since' rung with this false still full-enumerates in practice.",
  })
  deltaPassEnabled!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'ISO timestamp of the last COMPLETED deletion-reconciliation cycle for this connection ' +
      '(master.product.reconcile). Null = no cycle has completed yet. The hourly cron is the ' +
      'tick, not the cycle — a cycle spans ceil(N / budget) ticks.',
  })
  lastReconcileCompletedAt!: string | null;

  @ApiProperty({
    description:
      'A reconciliation cycle has started and not yet completed. Not "actively running" — the ' +
      'cycle advances only when the hourly tick runs and may be stalled by failures.',
  })
  reconcileCycleOpen!: boolean;
}
