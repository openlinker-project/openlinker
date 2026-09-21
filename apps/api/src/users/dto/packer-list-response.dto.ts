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
 * @module apps/api/src/users/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { User } from '@openlinker/core/users';

export class PackerSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;

  static fromDomain(user: User): PackerSummaryDto {
    const dto = new PackerSummaryDto();
    dto.id = user.id;
    dto.username = user.username;
    return dto;
  }
}

export class PackerListResponseDto {
  @ApiProperty({ type: [PackerSummaryDto] }) packers!: PackerSummaryDto[];

  static fromDomain(users: readonly User[]): PackerListResponseDto {
    const dto = new PackerListResponseDto();
    dto.packers = users.map((u) => PackerSummaryDto.fromDomain(u));
    return dto;
  }
}
