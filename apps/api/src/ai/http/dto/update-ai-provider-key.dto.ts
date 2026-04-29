/**
 * Update AI Provider Key DTO
 *
 * Request body for `PUT /ai-provider-settings/keys/:provider`. The single
 * field carries the API key the admin pasted into the form. Length bounds
 * are loose on purpose — vendor key prefixes have changed before, so a
 * brittle prefix check would invite breakage on a future rotation.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 512;

/**
 * Trim incoming `apiKey` before validation. Pasted secrets often carry
 * stray newlines or surrounding whitespace from clipboard managers; storing
 * those verbatim yields a 401 from the upstream provider with no obvious
 * cause. Trim once at the boundary so length / non-empty assertions reflect
 * the value we'll actually persist.
 */
export class UpdateAiProviderKeyDto {
  @ApiProperty({
    description:
      'API key for the targeted AI provider. Stored encrypted; never returned in any response body. ' +
      'Surrounding whitespace is trimmed before validation and storage.',
    minLength: MIN_KEY_LENGTH,
    maxLength: MAX_KEY_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_KEY_LENGTH)
  @MaxLength(MAX_KEY_LENGTH)
  apiKey!: string;
}
