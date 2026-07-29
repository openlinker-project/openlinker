/**
 * PostHog Settings Controller
 *
 * Admin-only REST surface for the DB-backed PostHog analytics settings.
 * Mirrors `MailerSettingsController` one-for-one: non-secret settings are
 * readable/writable via `GET`/`PUT /posthog-settings`, and the API key is
 * write-only via a separate `PUT`/`DELETE /posthog-settings/credentials`
 * pair so it never round-trips through a response body.
 *
 * Endpoints:
 *
 *   GET    /posthog-settings              — non-secret settings view
 *   PUT    /posthog-settings              — update enabled/region/host/autocapture/sessionRecording
 *   PUT    /posthog-settings/credentials  — set/rotate the PostHog API key
 *   DELETE /posthog-settings/credentials  — clear the PostHog API key
 *
 * @module apps/api/src/analytics/http
 */
import {
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
import { Response } from 'express';
import { POSTHOG_SETTINGS_SERVICE_TOKEN, type IPosthogSettingsService } from '@openlinker/core/analytics';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PosthogSettingsResponseDto } from './dto/posthog-settings-response.dto';
import { SetPosthogCredentialsDto } from './dto/set-posthog-credentials.dto';
import { UpdatePosthogSettingsDto } from './dto/update-posthog-settings.dto';

@ApiBearerAuth()
@ApiTags('posthog-settings')
@Controller('posthog-settings')
export class PosthogSettingsController {
  constructor(
    @Inject(POSTHOG_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IPosthogSettingsService
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'Read the PostHog analytics settings (never returns the API key)' })
  @ApiResponse({ status: 200, type: PosthogSettingsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async get(@Res({ passthrough: true }) res: Response): Promise<PosthogSettingsResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    const view = await this.settings.getSettings();
    return PosthogSettingsResponseDto.fromView(view);
  }

  @Roles('admin')
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update the non-secret enabled/region/host/autocapture/sessionRecording settings' })
  @ApiResponse({ status: 204, description: 'Settings updated' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async update(
    @Body() dto: UpdatePosthogSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.settings.updateSettings(
      {
        enabled: dto.enabled,
        region: dto.region,
        customHost: dto.region === 'custom' ? (dto.customHost ?? null) : null,
        autocapture: dto.autocapture,
        sessionRecording: dto.sessionRecording,
      },
      user?.id
    );
  }

  @Roles('admin')
  @Put('credentials')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set or rotate the PostHog project API key' })
  @ApiResponse({ status: 204, description: 'API key stored encrypted' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async setCredentials(
    @Body() dto: SetPosthogCredentialsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.settings.setApiKey(dto.apiKey, user?.id);
  }

  @Roles('admin')
  @Delete('credentials')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear the stored PostHog API key (falls back to env or none)' })
  @ApiResponse({ status: 204, description: 'API key cleared' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async clearCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.settings.clearApiKey(user?.id);
  }
}
