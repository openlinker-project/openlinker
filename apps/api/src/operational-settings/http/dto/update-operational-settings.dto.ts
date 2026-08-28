/**
 * Update Operational Settings DTO
 *
 * Request body for `PUT /operational-settings`. Every field is optional; an
 * omitted field is left as it was and an explicit `null` clears it back to the
 * env-or-default rung.
 *
 * The `@Min`/`@Max` decorators are a convenience for the OpenAPI document and
 * for a fast rejection - they are NOT the gate. `OperationalSettingsService`
 * re-checks every bound against `OPERATIONAL_SETTING_BOUNDS`, because that is
 * the one table the worker's own clamp also reads, and a DTO enum that drifts
 * from it would accept a value the worker silently narrows.
 *
 * There is deliberately NO field for enabling or disabling the deletion audit:
 * #2222 made `master.product.reconcile` the deletion authority, and switching
 * it off silently reopens #1689.
 *
 * @module apps/api/src/operational-settings/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { OPERATIONAL_SETTING_BOUNDS } from '@openlinker/core/operational-settings';

const BOUNDS = OPERATIONAL_SETTING_BOUNDS;

export class UpdateOperationalSettingsDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: BOUNDS.catalogueSweepBudget.min,
    maximum: BOUNDS.catalogueSweepBudget.max,
    description:
      'Products enqueued per `master.product.syncAll` tick. `null` clears it back to the env var, then to the built-in default.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(BOUNDS.catalogueSweepBudget.min)
  @Max(BOUNDS.catalogueSweepBudget.max)
  catalogueSweepBudget?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: BOUNDS.inventorySweepBudget.min,
    maximum: BOUNDS.inventorySweepBudget.max,
    description: 'Products enqueued per `master.inventory.syncAll` tick.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(BOUNDS.inventorySweepBudget.min)
  @Max(BOUNDS.inventorySweepBudget.max)
  inventorySweepBudget?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: BOUNDS.sweepPageSize.min,
    maximum: BOUNDS.sweepPageSize.max,
    description:
      'Products one batch child covers. Capped at the master platforms’ own collection page size.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(BOUNDS.sweepPageSize.min)
  @Max(BOUNDS.sweepPageSize.max)
  sweepPageSize?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: BOUNDS.deletionAuditBudget.min,
    maximum: BOUNDS.deletionAuditBudget.max,
    description: 'Mappings re-checked per `master.product.reconcile` tick.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(BOUNDS.deletionAuditBudget.min)
  @Max(BOUNDS.deletionAuditBudget.max)
  deletionAuditBudget?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '0 * * * *',
    description:
      'Cron expression for the deletion audit (5 or 6 fields). Must fire at least once every 7 days — the audit is the deletion authority and cannot be disabled here.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  deletionAuditCadence?: string | null;
}
