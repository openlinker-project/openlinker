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

  @ApiProperty({
    description:
      'Our recommended ceiling. Advisory — a write above it is accepted with `acknowledgeAboveRecommended`.',
  })
  recommendedMax!: number;

  @ApiProperty({ description: 'Why the recommendation sits where it does.' })
  recommendedReason!: string;

  @ApiProperty({ description: 'The refusal line. No acknowledgement can exceed it.' })
  absoluteMax!: number;

  @ApiProperty({ description: 'Why the absolute ceiling sits where it does.' })
  absoluteReason!: string;

  @ApiProperty({
    description:
      'True when this value exceeds our recommendation — the UI should show it as a deliberate override rather than an ordinary setting.',
  })
  aboveRecommended!: boolean;
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

  @ApiProperty({ description: 'Advisory ceiling; exceedable with an explicit acknowledgement.' })
  recommendedMax!: number;

  @ApiProperty()
  recommendedReason!: string;

  @ApiProperty({ description: 'Hard ceiling; refused whatever the request says.' })
  absoluteMax!: number;

  @ApiProperty()
  absoluteReason!: string;

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
      'The two ceilings, built-in default and env var for each numeric knob — the same table the API validator and the worker clamp read. A form derives its limits from this rather than restating them.',
  })
  bounds!: Record<string, OperationalSettingBoundDto>;

  @ApiProperty({
    description:
      'A platform may narrow a page size further where its own API caps it (WooCommerce caps `per_page` at 100). That clamp is applied where the request is built and logged when it bites, so a value shown here is never quietly not what was sent.',
  })
  adapterClampNote!: string;

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
    dto.adapterClampNote =
      'A page size above what a specific adapter can send is clamped where the request is built, and the clamp is logged.';
    dto.bounds = Object.fromEntries(
      OPERATIONAL_SETTING_KEYS.map((key) => [key, { ...OPERATIONAL_SETTING_BOUNDS[key] }])
    );
    return dto;
  }
}
