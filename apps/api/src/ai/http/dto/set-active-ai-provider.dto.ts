/**
 * Set Active AI Provider DTO
 *
 * Request body for `PUT /ai-provider-settings/active`. Carries the provider
 * key the admin is switching to. The path is intentionally on the parent
 * resource — operators are switching the *whole* AI subsystem, not editing
 * a setting on one provider row.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AiProvider, AiProviderValues } from '@openlinker/core/ai';

export class SetActiveAiProviderDto {
  @ApiProperty({
    enum: AiProviderValues,
    description: 'Provider to make active. Must already have a key configured (when required).',
  })
  @IsIn(AiProviderValues as unknown as string[])
  provider!: AiProvider;
}
