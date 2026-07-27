/**
 * Mailer Settings Controller
 *
 * Admin-only REST surface for the DB-backed mailer/SMTP settings.
 * Mirrors `AiProviderSettingsController` one-for-one: non-secret settings
 * are readable/writable via `GET`/`PUT /mailer-settings`, and the SMTP
 * password is write-only via a separate `PUT`/`DELETE /mailer-settings/credentials`
 * pair so it never round-trips through a response body.
 *
 * Endpoints:
 *
 *   GET    /mailer-settings              — non-secret settings view
 *   PUT    /mailer-settings              — update transport/host/port/secure/from
 *   PUT    /mailer-settings/credentials  — set/rotate the SMTP password
 *   DELETE /mailer-settings/credentials  — clear the SMTP password
 *
 * @module apps/api/src/mailer/http
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
import {
  MAILER_SETTINGS_SERVICE_TOKEN,
  type IMailerSettingsService,
} from '@openlinker/core/mailer';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MailerSettingsResponseDto } from './dto/mailer-settings-response.dto';
import { SetMailerCredentialsDto } from './dto/set-mailer-credentials.dto';
import { UpdateMailerSettingsDto } from './dto/update-mailer-settings.dto';

@ApiBearerAuth()
@ApiTags('mailer-settings')
@Controller('mailer-settings')
export class MailerSettingsController {
  constructor(
    @Inject(MAILER_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IMailerSettingsService
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'Read the mailer/SMTP settings (never returns the password)' })
  @ApiResponse({ status: 200, type: MailerSettingsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async get(@Res({ passthrough: true }) res: Response): Promise<MailerSettingsResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    const view = await this.settings.getSettings();
    return MailerSettingsResponseDto.fromView(view);
  }

  @Roles('admin')
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update the non-secret transport/host/port/secure/from settings' })
  @ApiResponse({ status: 204, description: 'Settings updated' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async update(
    @Body() dto: UpdateMailerSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.settings.updateSettings(
      {
        transport: dto.transport,
        smtpHost: dto.smtpHost ?? null,
        smtpPort: dto.smtpPort ?? null,
        smtpSecure: dto.smtpSecure,
        fromAddress: dto.fromAddress ?? null,
      },
      user?.id
    );
  }

  @Roles('admin')
  @Put('credentials')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set or rotate the SMTP password' })
  @ApiResponse({ status: 204, description: 'Password stored encrypted' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async setCredentials(
    @Body() dto: SetMailerCredentialsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.settings.setSmtpPassword(dto.password, user?.id);
  }

  @Roles('admin')
  @Delete('credentials')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear the stored SMTP password (falls back to env or none)' })
  @ApiResponse({ status: 204, description: 'Password cleared' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async clearCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.settings.clearSmtpPassword(user?.id);
  }
}
