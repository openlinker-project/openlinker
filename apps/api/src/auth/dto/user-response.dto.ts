/**
 * User Response DTO
 *
 * Response body for GET /auth/me. Exposes safe user fields only — never
 * returns passwordHash or internal infrastructure details. Includes role
 * and derived permissions for frontend authorization decisions.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  UserRoleValues,
  PermissionValues,
  ROLE_PERMISSIONS,
  UserRole,
} from '@openlinker/core/users';
import type { Permission, User } from '@openlinker/core/users';

export class UserResponseDto {
  @ApiProperty({ description: 'Internal user ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'Username' })
  username!: string;

  @ApiPropertyOptional({ description: 'Email address', nullable: true })
  email!: string | null;

  @ApiProperty({ description: 'User role', enum: UserRoleValues })
  role!: UserRole;

  @ApiProperty({
    description: 'Permissions derived from role',
    enum: PermissionValues,
    isArray: true,
  })
  permissions!: Permission[];

  @ApiProperty({
    description: 'Whether the account opted in to demo-only usage analytics (#1743)',
  })
  analyticsConsent!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      "The signed-in user's own bench/printer label (#3404), e.g. " +
      '"Zebra ZD420 · Bench 3", or null if none is set. This is the VIEWER\'S ' +
      'own configuration, never another user\'s, so there is no PII question ' +
      'in returning it on /auth/me — unlike a colleague\'s lastActiveAt, which ' +
      'is deliberately never projected here.',
  })
  packStationLabel!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      "The person's name as an admin typed it at account creation (#3456), or null. " +
      'Display only; `username` stays the login.',
  })
  displayName!: string | null;

  @ApiProperty({
    description:
      'The account must set a new password before anything else (#3456): it was ' +
      'created with an admin-issued one-time password. While true, every other route ' +
      'answers 403 PASSWORD_CHANGE_REQUIRED; POST /auth/me/password clears it.',
  })
  mustChangePassword!: boolean;

  static fromDomain(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.role = user.role;
    // ?? [] guards against DB role values that violate the UserRole type contract at runtime
    dto.permissions = [...(ROLE_PERMISSIONS[user.role] ?? [])];
    dto.analyticsConsent = user.analyticsConsent;
    dto.packStationLabel = user.packStationLabel;
    dto.displayName = user.displayName;
    dto.mustChangePassword = user.mustChangePassword;
    return dto;
  }
}
