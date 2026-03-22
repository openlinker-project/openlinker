/**
 * User Response DTO
 *
 * Response body for GET /auth/me. Exposes safe user fields only — never
 * returns passwordHash or internal infrastructure details.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '@openlinker/core/users';

export class UserResponseDto {
  @ApiProperty({ description: 'Internal user ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'Username' })
  username!: string;

  @ApiPropertyOptional({ description: 'Email address', nullable: true })
  email!: string | null;

  static fromDomain(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    return dto;
  }
}
