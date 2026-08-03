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
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  @ApiPropertyOptional({
    description:
      "Acceptance of the demo's session-recording condition (#1938). Must be `true` on a " +
      'demo-mode instance — recording is a condition of using the demo, disclosed at ' +
      'registration, so a registration that omits it or carries `false` is rejected there ' +
      '(400, by `RegistrationService`). Outside demo mode nothing records; the field is ' +
      'optional and defaults to `false`.',
    example: true,
  })
  // Deliberately optional at the DTO layer even though the demo requires it
  // (#1945 review): the rule is demo-only, so a required field would hard-400
  // every self-hosted client that omits it for a flag that does nothing there.
  // The demo guarantee is carried by the service-level check instead, which
  // rejects both an omitted and a `false` value on a demo instance.
  @IsOptional()
  @IsBoolean()
  analyticsConsent?: boolean;
}
