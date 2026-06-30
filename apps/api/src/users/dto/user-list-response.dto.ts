/**
 * User List Response DTO
 *
 * Response shape for GET /users. Exposes safe public fields — never the
 * passwordHash.
 *
 * @module apps/api/src/users/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { UserRoleValues, UserStatusValues , UserRole, UserStatus } from '@openlinker/core/users';
import type { User } from '@openlinker/core/users';

export class UserSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ enum: UserRoleValues }) role!: UserRole;
  @ApiProperty({ enum: UserStatusValues }) status!: UserStatus;
  @ApiProperty() createdAt!: Date;

  static fromDomain(user: User): UserSummaryDto {
    const dto = new UserSummaryDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.role = user.role;
    dto.status = user.status;
    dto.createdAt = user.createdAt;
    return dto;
  }
}

export class UserListResponseDto {
  @ApiProperty({ type: [UserSummaryDto] }) users!: UserSummaryDto[];
  @ApiProperty() total!: number;

  static fromDomain(result: { users: User[]; total: number }): UserListResponseDto {
    const dto = new UserListResponseDto();
    dto.users = result.users.map((u) => UserSummaryDto.fromDomain(u));
    dto.total = result.total;
    return dto;
  }
}
