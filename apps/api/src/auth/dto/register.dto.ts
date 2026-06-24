/**
 * Register DTO
 *
 * Request body for POST /auth/register. Validated by the global ValidationPipe.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: 'Username', example: 'alice' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ description: 'Email address', example: 'alice@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ description: 'Password (minimum 8 characters)', example: 'correct-horse-battery' })
  @IsString()
  @MinLength(8)
  password!: string;
}
