/**
 * AI Provider Settings Controller
 *
 * Admin-only REST surface for managing the AI provider's API key. Backed by
 * `IAiProviderSettingsService`, which writes to the encrypted
 * `integration_credentials` store and invalidates the credentials port's
 * cache after every write.
 *
 * Path is `/ai-provider-settings` — single, top-level resource path
 * matching the BE convention used by `prompt-templates` and `connections`.
 * The frontend route lives at `/ai/provider-settings` (FE namespace) and
 * the API client maps between the two.
 *
 * @module apps/api/src/ai/http
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AI_PROVIDER_SETTINGS_SERVICE_TOKEN,
  AiProviderSettingsNotApplicableError,
  IAiProviderSettingsService,
} from '@openlinker/core/ai';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AiProviderSettingsResponseDto } from './dto/ai-provider-settings-response.dto';
import { UpdateAiProviderSettingsDto } from './dto/update-ai-provider-settings.dto';

@ApiBearerAuth()
@ApiTags('ai-provider-settings')
@Controller('ai-provider-settings')
export class AiProviderSettingsController {
  constructor(
    @Inject(AI_PROVIDER_SETTINGS_SERVICE_TOKEN)
    private readonly service: IAiProviderSettingsService,
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'Read AI provider key status (never returns the key)' })
  @ApiResponse({ status: 200, type: AiProviderSettingsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async get(
    @Res({ passthrough: true }) res: Response,
  ): Promise<AiProviderSettingsResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    const view = await this.service.get();
    return AiProviderSettingsResponseDto.fromView(view);
  }

  @Roles('admin')
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set or rotate the AI provider API key' })
  @ApiResponse({ status: 204, description: 'Key stored encrypted' })
  @ApiResponse({
    status: 400,
    description:
      'Active provider does not require an API key (e.g. OL_AI_PROVIDER=fake), or the request body failed validation',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async set(
    @Body() dto: UpdateAiProviderSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.withDomainExceptionMapping(() => this.service.set(dto.apiKey, user?.id));
  }

  @Roles('admin')
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove the stored AI provider API key (falls back to env or none)',
  })
  @ApiResponse({ status: 204, description: 'Key cleared' })
  @ApiResponse({
    status: 400,
    description: 'Active provider does not require an API key',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async clear(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.withDomainExceptionMapping(() => this.service.clear(user?.id));
  }

  private async withDomainExceptionMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AiProviderSettingsNotApplicableError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
