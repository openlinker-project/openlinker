/**
 * Operational Settings Response DTO
 *
 * Response body for `GET /operational-settings`. Every value travels WITH the
 * rung that produced it, so a UI renders `500 (default)` instead of comparing
 * against a hardcoded number - a client-side comparison is a second copy of
 * the default, and it is wrong the day the default moves.
 *
 * It also carries the `bounds` block, read straight off
 * `OPERATIONAL_SETTING_BOUNDS`. The form derives its `min`/`max` from that
 * rather than restating them, which is what keeps "what the API accepts" and
 * "what the control allows" one fact.
 *
 * @module apps/api/src/operational-settings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  OPERATIONAL_SETTING_BOUNDS,
  OPERATIONAL_SETTING_KEYS,
  OPERATIONAL_SETTING_SOURCES,
  type OperationalSettingSource,
  type OperationalSettingsView,
} from '@openlinker/core/operational-settings';

export class ResolvedNumberSettingDto {
  @ApiProperty({ description: 'The effective value the worker applies.' })
  value!: number;

  @ApiProperty({
    enum: OPERATIONAL_SETTING_SOURCES,
    description:
      '`setting` (an operator saved it), `env` (an environment variable), or `default` (nobody has chosen).',
  })
  source!: OperationalSettingSource;
}

export class ResolvedCadenceSettingDto {
  @ApiProperty({ description: 'The effective cron expression.' })
  value!: string;

  @ApiProperty({ enum: OPERATIONAL_SETTING_SOURCES })
  source!: OperationalSettingSource;
}

export class OperationalSettingBoundDto {
  @ApiProperty()
  min!: number;

  @ApiProperty()
  max!: number;

  @ApiProperty({ description: 'The built-in value used when neither a row nor an env var sets one.' })
  default!: number;

  @ApiProperty({ description: 'The environment variable consulted between the row and the default.' })
  envVar!: string;
}

export class OperationalSettingsResponseDto {
  @ApiProperty({ type: ResolvedNumberSettingDto })
  catalogueSweepBudget!: ResolvedNumberSettingDto;

  @ApiProperty({ type: ResolvedNumberSettingDto })
  inventorySweepBudget!: ResolvedNumberSettingDto;

  @ApiProperty({ type: ResolvedNumberSettingDto })
  sweepPageSize!: ResolvedNumberSettingDto;

  @ApiProperty({ type: ResolvedNumberSettingDto })
  deletionAuditBudget!: ResolvedNumberSettingDto;

  @ApiProperty({ type: ResolvedCadenceSettingDto })
  deletionAuditCadence!: ResolvedCadenceSettingDto;

  @ApiProperty({
    description:
      'Always `true`. The deletion audit is the deletion authority (#2222) and has no off switch on this surface; turning it off would silently reopen #1689.',
  })
  deletionAuditAlwaysEnabled!: boolean;

  @ApiProperty({
    description:
      'A budget change is picked up by the next sweep tick, with no worker restart. The cadence is read when the scheduler registers its cron jobs, so a cadence change applies at the next scheduler start — a lease hand-over or a worker restart.',
  })
  cadenceAppliesAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the settings row was last written. `null` when no row exists.',
  })
  updatedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  updatedBy!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'object' },
    description:
      'The accepted range, built-in default and env var for each numeric knob — the same table the API validator and the worker clamp read.',
  })
  bounds!: Record<string, OperationalSettingBoundDto>;

  static fromView(view: OperationalSettingsView): OperationalSettingsResponseDto {
    const dto = new OperationalSettingsResponseDto();
    dto.catalogueSweepBudget = { ...view.catalogueSweepBudget };
    dto.inventorySweepBudget = { ...view.inventorySweepBudget };
    dto.sweepPageSize = { ...view.sweepPageSize };
    dto.deletionAuditBudget = { ...view.deletionAuditBudget };
    dto.deletionAuditCadence = { ...view.deletionAuditCadence };
    dto.deletionAuditAlwaysEnabled = view.deletionAuditAlwaysEnabled;
    dto.cadenceAppliesAt = 'next-scheduler-start';
    dto.updatedAt = view.updatedAt ? view.updatedAt.toISOString() : null;
    dto.updatedBy = view.updatedBy;
    dto.bounds = Object.fromEntries(
      OPERATIONAL_SETTING_KEYS.map((key) => [key, { ...OPERATIONAL_SETTING_BOUNDS[key] }])
    );
    return dto;
  }
}
