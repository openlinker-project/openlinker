/**
 * Confirm Email DTO
 *
 * Request body for POST /auth/confirm-email.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmEmailDto {
  @ApiProperty({ description: 'One-time email confirmation token from the confirmation email/link' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
