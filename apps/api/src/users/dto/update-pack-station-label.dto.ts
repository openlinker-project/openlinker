/**
 * Update Pack Station Label DTO (#3424)
 *
 * Request body for `PATCH /users/:id/pack-station-label`.
 *
 * `null` is an explicit CLEAR and a first-class value, which is why the field
 * is nullable rather than optional: an omitted field and a cleared one would
 * otherwise be the same request, and a supervisor removing a stale printer
 * name would silently change nothing.
 *
 * @module apps/api/src/users/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * A generous bound rather than a tight one: this is a free-text operator
 * label ("Bench 3 / Zebra ZD420", "Pakowanie - stanowisko przy rampie"), so
 * the limit exists to stop a pasted document reaching the column, not to
 * impose a naming scheme nobody agreed to.
 */
export const PACK_STATION_LABEL_MAX_LENGTH = 120;

export class UpdatePackStationLabelDto {
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: PACK_STATION_LABEL_MAX_LENGTH,
    description:
      "The packer's own bench/printer label, or null to clear it. Operator " +
      'configuration, never identity: it authenticates nothing (ADR-071 ' +
      'refuses a station principal). A blank string is stored as null, so ' +
      '"no label" has exactly one spelling in the column.',
    example: 'Bench 3 / Zebra ZD420',
  })
  // `ValidateIf` rather than `IsOptional`: `IsOptional` skips validation for
  // `null` AND `undefined` alike, which would let an omitted field through as
  // a silent no-op clear. This validates the string rules only when a string
  // was actually sent, while still admitting an explicit `null`.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PACK_STATION_LABEL_MAX_LENGTH)
  @IsOptional()
  packStationLabel!: string | null;
}
