/**
 * Resend Confirmation DTO
 *
 * Request body for POST /auth/resend-confirmation.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ResendConfirmationDto {
  @ApiProperty({ description: 'Email associated with the pending account', example: 'demo@example.com' })
  @IsEmail()
  email!: string;
}
