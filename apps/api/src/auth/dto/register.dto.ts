/**
 * Register DTO
 *
 * Request body for POST /auth/register. Validated by the global ValidationPipe.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: 'Username (must not contain "@")', example: 'alice' })
  @IsString()
  @IsNotEmpty()
  // Forbid '@' so a username can never collide with an email on the shared
  // login identifier field — AuthService.validateUser routes '@'-bearing
  // identifiers to the email lookup and '@'-free ones to the username lookup.
  @Matches(/^[^@]+$/, { message: 'Username must not contain "@"' })
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
}
