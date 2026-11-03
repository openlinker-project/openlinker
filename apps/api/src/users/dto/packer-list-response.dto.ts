/**
 * Packer List Response DTO (#3340)
 *
 * Response shape for `GET /users/packers` — the roster the Assign Packing
 * Work screen renders as swimlanes. Deliberately NARROWER than
 * `UserSummaryDto`: no email, no status, no createdAt. This endpoint is
 * reachable by `operator` as well as `admin` (unlike `GET /users`, which
 * stays admin-only), so its response carries only what a swimlane header
 * needs — never the fuller user-management projection.
 *
 * ## `online` is DERIVED, never a column (#3424)
 *
 * It is `isPackerOnline(user.lastActiveAt)`, a threshold over the heartbeat
 * evaluated at read time. A stored boolean would need something to flip it
 * back off and nothing would: a packer who closes the tab, loses the network
 * or goes home sends no "leaving" signal, so the board would report the whole
 * warehouse as permanently on shift.
 *
 * The raw `lastActiveAt` instant is deliberately NOT projected. A supervisor
 * needs to know whether a bench is staffed, and "last seen 14:32" is a
 * timesheet - a different, far more sensitive claim about a colleague that no
 * swimlane header needs to make.
 *
 * @module apps/api/src/users/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { isPackerOnline } from '@openlinker/core/users';
import type { User } from '@openlinker/core/users';

export class PackerSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The packer's name as an admin typed it at account creation (#3456), or null. " +
      'A swimlane header renders it, falling back to `username`.',
  })
  displayName!: string | null;

  @ApiProperty({
    description:
      'Whether this packer has touched a bench recently enough to read as at ' +
      'one. Derived from a presence threshold at read time, never stored, and ' +
      'bumped by bench activity rather than by a login - so a signed-in but ' +
      'idle account reads as offline rather than as staffed.',
  })
  online!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The packer's own free-text bench/printer label, e.g. " +
      '"Bench 3 / Zebra ZD420", or null if they have not set one. Operator ' +
      'configuration, not identity: it carries no authentication weight ' +
      '(ADR-071 refuses a station principal).',
  })
  stationLabel!: string | null;

  static fromDomain(user: User, now: Date = new Date()): PackerSummaryDto {
    const dto = new PackerSummaryDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.displayName = user.displayName;
    dto.online = isPackerOnline(user.lastActiveAt, now);
    dto.stationLabel = user.packStationLabel;
    return dto;
  }
}

export class PackerListResponseDto {
  @ApiProperty({ type: [PackerSummaryDto] }) packers!: PackerSummaryDto[];

  static fromDomain(users: readonly User[]): PackerListResponseDto {
    const dto = new PackerListResponseDto();
    // One `now` for the whole roster, taken once: mapping each packer against
    // its own `new Date()` could put two packers with the identical heartbeat
    // on opposite sides of the threshold in a single response.
    const now = new Date();
    dto.packers = users.map((u) => PackerSummaryDto.fromDomain(u, now));
    return dto;
  }
}
