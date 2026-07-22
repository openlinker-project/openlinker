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

  static fromDomain(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.role = user.role;
    // ?? [] guards against DB role values that violate the UserRole type contract at runtime
    dto.permissions = [...(ROLE_PERMISSIONS[user.role] ?? [])];
    dto.analyticsConsent = user.analyticsConsent;
    return dto;
  }
}
