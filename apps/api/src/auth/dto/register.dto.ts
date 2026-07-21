/**
 * Register DTO
 *
 * Request body for POST /auth/register. Validated by the global ValidationPipe.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: 'Username', example: 'alice' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ description: 'Email address', example: 'alice@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ description: 'Password (8–72 characters)', example: 'correct-horse-battery' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({
    description:
      'Opt-in for demo-only usage analytics. Omitted ⇒ treated as consent granted (default-on).',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  analyticsConsent?: boolean;
}
