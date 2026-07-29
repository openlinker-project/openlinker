/**
 * Set PostHog Credentials DTO
 *
 * Request body for `PUT /posthog-settings/credentials`. Write-only — the
 * API key is never echoed back in any response.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const MIN_API_KEY_LENGTH = 1;
const MAX_API_KEY_LENGTH = 128;

export class SetPosthogCredentialsDto {
  @ApiProperty({
    description:
      'PostHog project API key. Stored encrypted; never returned in any response body. Surrounding whitespace is trimmed.',
    minLength: MIN_API_KEY_LENGTH,
    maxLength: MAX_API_KEY_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_API_KEY_LENGTH)
  @MaxLength(MAX_API_KEY_LENGTH)
  apiKey!: string;
}
