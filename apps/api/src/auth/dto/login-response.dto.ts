/**
 * Login Response DTO
 *
 * Response body for a successful POST /auth/login.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  access_token!: string;
}
