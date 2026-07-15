/**
 * Set Mailer Credentials DTO
 *
 * Request body for `PUT /mailer-settings/credentials`. Write-only — the
 * password is never echoed back in any response.
 *
 * @module apps/api/src/mailer/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const MIN_PASSWORD_LENGTH = 1;
const MAX_PASSWORD_LENGTH = 512;

export class SetMailerCredentialsDto {
  @ApiProperty({
    description:
      'SMTP password. Stored encrypted; never returned in any response body. Surrounding whitespace is trimmed.',
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;
}
