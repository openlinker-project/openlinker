/**
 * Forgot Password DTO
 *
 * Request body for POST /auth/forgot-password.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ description: 'Email associated with the account', example: 'admin@example.com' })
  @IsEmail()
  email!: string;
}
