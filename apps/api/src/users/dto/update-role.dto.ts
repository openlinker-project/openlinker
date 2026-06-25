/**
 * Update Role DTO
 *
 * Request body for PATCH /users/:id/role.
 *
 * @module apps/api/src/users/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { UserRoleValues, type UserRole } from '@openlinker/core/users';

export class UpdateRoleDto {
  @ApiProperty({ description: 'New role', enum: UserRoleValues, example: 'viewer' })
  @IsIn(UserRoleValues)
  @IsNotEmpty()
  role!: UserRole;
}
