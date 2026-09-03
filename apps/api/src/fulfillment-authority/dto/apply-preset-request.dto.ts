/**
 * Preset Request DTO (#2353)
 *
 * Shared by the preview and the apply — one preset id, validated at the
 * boundary against the closed catalogue so an unknown value is a 400 rather
 * than a lookup miss deeper in.
 *
 * @module apps/api/src/fulfillment-authority/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  AuthorityPresetIdValues,
  type AuthorityPresetId,
} from '../application/authority-presets';

export class ApplyPresetRequestDto {
  @ApiProperty({
    enum: AuthorityPresetIdValues,
    description:
      'Which arrangement to preview or apply. Closed set of three; there is no custom-preset ' +
      'shape in v1 (a needed per-authority override is a missing preset, spec §1.1).',
  })
  @IsIn(AuthorityPresetIdValues)
  presetId!: AuthorityPresetId;
}
