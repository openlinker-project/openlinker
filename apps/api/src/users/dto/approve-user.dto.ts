/**
 * Approve User DTO
 *
 * Request body for POST /users/:id/approve. Assigns a role when approving
 * a pending registration.
 *
 * @module apps/api/src/users/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { UserRoleValues, type UserRole } from '@openlinker/core/users';

export class ApproveUserDto {
  @ApiProperty({ description: 'Role to assign', enum: UserRoleValues, example: 'viewer' })
  @IsIn(UserRoleValues)
  @IsNotEmpty()
  role!: UserRole;
}
