/**
 * AI Provider Settings Controller
 *
 * Admin-only REST surface for managing per-provider AI API keys and the
 * active-provider selection. Backed by `IAiProviderKeyService` (writes the
 * encrypted credential row + invalidates the credentials port's cache) and
 * `IAiProviderActiveSettingsService` (persists the singleton-row active
 * selection).
 *
 * Path is `/ai-provider-settings` — single, top-level resource path
 * matching the BE convention used by `prompt-templates` and `connections`.
 * The frontend route lives at `/ai/provider-settings` (FE namespace) and
 * the API client maps between the two.
 *
 * Endpoints:
 *
 *   GET    /ai-provider-settings                       — multi-provider view
 *   PUT    /ai-provider-settings/keys/:provider        — set/rotate per-provider key
 *   DELETE /ai-provider-settings/keys/:provider        — clear per-provider key
 *   PUT    /ai-provider-settings/active                — switch active provider
 *
 * The legacy single-key endpoints (`PUT /` / `DELETE /`) are removed in
 * the same change that introduces this multi-provider surface — see the
 * issue body for the breaking-change call-out.
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
  NotFoundException,
  Param,
  Put,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN,
  AI_PROVIDER_KEY_SERVICE_TOKEN,
  AiProviderActivationError,
  AiProviderSettingsNotApplicableError,
  AiProviderValues,
  type AiProvider,
  type IAiProviderKeyService,
} from '@openlinker/core/ai';
import { IAiProviderActiveSettingsService } from '@openlinker/core/ai';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AiProviderSettingsResponseDto } from './dto/ai-provider-settings-response.dto';
import { SetActiveAiProviderDto } from './dto/set-active-ai-provider.dto';
import { UpdateAiProviderKeyDto } from './dto/update-ai-provider-key.dto';

const isAiProvider = (value: string): value is AiProvider =>
  (AiProviderValues as readonly string[]).includes(value);

@ApiBearerAuth()
@ApiTags('ai-provider-settings')
@Controller('ai-provider-settings')
export class AiProviderSettingsController {
  constructor(
    @Inject(AI_PROVIDER_KEY_SERVICE_TOKEN)
    private readonly keys: IAiProviderKeyService,
    @Inject(AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN)
    private readonly active: IAiProviderActiveSettingsService
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({
    summary: 'Read the multi-provider settings view (active provider + per-provider key status)',
  })
  @ApiResponse({ status: 200, type: AiProviderSettingsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async get(@Res({ passthrough: true }) res: Response): Promise<AiProviderSettingsResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    const view = await this.active.getMultiProviderView();
    return AiProviderSettingsResponseDto.fromView(view);
  }

  @Roles('admin')
  @Put('keys/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set or rotate the API key for a specific provider' })
  @ApiParam({ name: 'provider', enum: AiProviderValues })
  @ApiResponse({ status: 204, description: 'Key stored encrypted' })
  @ApiResponse({
    status: 400,
    description:
      'Provider does not require an API key (e.g. `fake`), or the request body failed validation',
  })
  @ApiResponse({ status: 404, description: 'Unknown provider key in URL' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async setKey(
    @Param('provider') providerParam: string,
    @Body() dto: UpdateAiProviderKeyDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const provider = this.parseProvider(providerParam);
    await this.withDomainExceptionMapping(() => this.keys.setKey(provider, dto.apiKey, user?.id));
  }

  @Roles('admin')
  @Delete('keys/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove the stored API key for a specific provider (falls back to env or none for that provider)',
  })
  @ApiParam({ name: 'provider', enum: AiProviderValues })
  @ApiResponse({ status: 204, description: 'Key cleared' })
  @ApiResponse({ status: 400, description: 'Provider does not require an API key' })
  @ApiResponse({ status: 404, description: 'Unknown provider key in URL' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async clearKey(
    @Param('provider') providerParam: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const provider = this.parseProvider(providerParam);
    await this.withDomainExceptionMapping(() => this.keys.clearKey(provider, user?.id));
  }

  @Roles('admin')
  @Put('active')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Switch the active AI provider — takes effect on the next completion call',
  })
  @ApiResponse({ status: 204, description: 'Active provider updated' })
  @ApiResponse({
    status: 422,
    description: 'Target provider has no API key configured (when one is required)',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async setActive(
    @Body() dto: SetActiveAiProviderDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.withDomainExceptionMapping(() => this.active.setActive(dto.provider, user?.id));
  }

  private parseProvider(value: string): AiProvider {
    if (!isAiProvider(value)) {
      throw new NotFoundException(
        `Unknown AI provider '${value}'. Allowed values: ${AiProviderValues.join(', ')}.`
      );
    }
    return value;
  }

  private async withDomainExceptionMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AiProviderSettingsNotApplicableError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof AiProviderActivationError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }
}
