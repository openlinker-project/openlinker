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
 * the one table the worker's own clamp also reads, and a DTO limit that
 * drifted from it would accept a value the worker silently narrows.
 *
 * `@Max` is deliberately the ABSOLUTE ceiling, not the recommended one. The
 * recommended ceiling is advisory and may be exceeded with
 * `acknowledgeAboveRecommended`, so enforcing it here would refuse a legitimate
 * request before the service ever got to weigh the acknowledgement - and the
 * refusal would carry class-validator's generic message instead of the reason
 * the operator needs.
 *
 * There is deliberately NO field for enabling or disabling the deletion audit:
 * #2222 made `master.product.reconcile` the deletion authority, and switching
 * it off silently reopens #1689.
 *
 * @module apps/api/src/operational-settings/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { OPERATIONAL_SETTING_BOUNDS } from '@openlinker/core/operational-settings';

const BOUNDS = OPERATIONAL_SETTING_BOUNDS;

export class UpdateOperationalSettingsDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: BOUNDS.catalogueSweepBudget.min,
    maximum: BOUNDS.catalogueSweepBudget.absoluteMax,
    description:
      'Products enqueued per `master.product.syncAll` tick. Recommended maximum 2000; above that set `acknowledgeAboveRecommended`. `null` clears it back to the env var, then to the built-in default.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(BOUNDS.catalogueSweepBudget.min)
  @Max(BOUNDS.catalogueSweepBudget.absoluteMax)
  catalogueSweepBudget?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: BOUNDS.inventorySweepBudget.min,
    maximum: BOUNDS.inventorySweepBudget.absoluteMax,
    description:
      'Products enqueued per `master.inventory.syncAll` tick. Recommended maximum 2000; above that set `acknowledgeAboveRecommended`.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(BOUNDS.inventorySweepBudget.min)
  @Max(BOUNDS.inventorySweepBudget.absoluteMax)
  inventorySweepBudget?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: BOUNDS.sweepPageSize.min,
    maximum: BOUNDS.sweepPageSize.absoluteMax,
    description:
      'Products one batch child covers. Recommended maximum 100; above that set `acknowledgeAboveRecommended`. Hard-refused above 500, where the |-joined id filter starts to threaten the request-line limit.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(BOUNDS.sweepPageSize.min)
  @Max(BOUNDS.sweepPageSize.absoluteMax)
  sweepPageSize?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: BOUNDS.deletionAuditBudget.min,
    maximum: BOUNDS.deletionAuditBudget.absoluteMax,
    description:
      'Mappings re-checked per `master.product.reconcile` tick. Recommended maximum 2000; above that set `acknowledgeAboveRecommended`.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(BOUNDS.deletionAuditBudget.min)
  @Max(BOUNDS.deletionAuditBudget.absoluteMax)
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

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Permission to exceed a RECOMMENDED ceiling on this request. Never licenses exceeding an absolute ceiling, and is not stored — an operator who runs past our advice once does not thereby license every later write.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeAboveRecommended?: boolean;
}
