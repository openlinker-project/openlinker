/**
 * Login Page Settings Controller
 *
 * Admin read and write of the login-page copy shown on a real install
 * (#4028). The demo's copy is fixed in the frontend and is not edited here.
 *
 * @module apps/api/src/login-page-settings/http
 */
import {
  BadRequestException,
  Body,
  Controller,
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
  InvalidLoginPageSettingError,
  LOGIN_PAGE_SETTINGS_SERVICE_TOKEN,
  type ILoginPageSettingsService,
} from '@openlinker/core/login-page-settings';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { LoginPageSettingsResponseDto } from './dto/login-page-settings-response.dto';
import { UpdateLoginPageSettingsDto } from './dto/update-login-page-settings.dto';

@ApiBearerAuth()
@ApiTags('login-page-settings')
@Controller('login-page-settings')
export class LoginPageSettingsController {
  constructor(
    @Inject(LOGIN_PAGE_SETTINGS_SERVICE_TOKEN)
    private readonly settings: ILoginPageSettingsService
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({
    summary: 'Read the login-page copy per language, each field with the rung that produced it',
  })
  @ApiResponse({ status: 200, type: LoginPageSettingsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async get(@Res({ passthrough: true }) res: Response): Promise<LoginPageSettingsResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    return LoginPageSettingsResponseDto.fromView(await this.settings.resolve());
  }

  @Roles('admin')
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Update login-page copy. An omitted field is left alone; null or an empty string clears it back to env and then the default.',
  })
  @ApiResponse({ status: 204, description: 'Settings updated' })
  @ApiResponse({ status: 400, description: 'A value is too long; the message names the field.' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async update(
    @Body() dto: UpdateLoginPageSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await this.settings.updateSettings(
        { pl: dto.pl, en: dto.en, registrationEnabled: dto.registrationEnabled },
        user?.id ?? null
      );
    } catch (error) {
      if (error instanceof InvalidLoginPageSettingError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
