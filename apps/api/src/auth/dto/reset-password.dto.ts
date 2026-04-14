/**
 * Reset Password DTO
 *
 * Request body for POST /auth/reset-password.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'One-time reset token from the reset email/link' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ description: 'New password (minimum 8 characters)', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
