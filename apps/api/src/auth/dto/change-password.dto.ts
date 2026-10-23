/**
 * Change Password DTO (#3456)
 *
 * Request body for `POST /auth/me/password` — the signed-in user replaces
 * their own password (required first for an admin-issued one-time password).
 * Length bounds match registration: bcrypt reads at most 72 bytes.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'The current password (or the one-time password)' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ description: 'New password (8–72 characters)', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
