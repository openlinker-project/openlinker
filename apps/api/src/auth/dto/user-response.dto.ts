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
  User,
  UserRoleValues,
  PermissionValues,
  ROLE_PERMISSIONS,
} from '@openlinker/core/users';
import type { UserRole, Permission } from '@openlinker/core/users';

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

  static fromDomain(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.role = user.role;
    dto.permissions = [...ROLE_PERMISSIONS[user.role]];
    return dto;
  }
}
