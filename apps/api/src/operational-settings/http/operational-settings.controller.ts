/**
 * Operational Settings Controller
 *
 * Admin-only REST surface for the sweep budgets and deletion-audit cadence
 * (#2651) - the knobs that decide how hard OpenLinker works a shop's
 * catalogue, and which until now were code constants an operator could only
 * reach by editing a `.env` and restarting the worker.
 *
 * Endpoints:
 *
 *   GET /operational-settings   - resolved values, each with its provenance
 *   PUT /operational-settings   - partial update (204)
 *
 * Shape mirrors `/posthog-settings` and `/currency-settings`: `@Roles('admin')`
 * on every handler, `Cache-Control: no-store`, a 204 write, and a
 * `withDomainExceptionMapping` boundary so core never constructs a NestJS
 * exception.
 *
 * OUT OF SCOPE, deliberately: the outbound request rate limit. It is a
 * per-connection fact, already validated by
 * `ConnectionService.validateRateLimitConfig` and already edited on the
 * connection form. Adding it here would give one value two homes.
 *
 * @module apps/api/src/operational-settings/http
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
  InvalidOperationalSettingError,
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
  type IOperationalSettingsService,
} from '@openlinker/core/operational-settings';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { OperationalSettingsResponseDto } from './dto/operational-settings-response.dto';
import { UpdateOperationalSettingsDto } from './dto/update-operational-settings.dto';

@ApiBearerAuth()
@ApiTags('operational-settings')
@Controller('operational-settings')
export class OperationalSettingsController {
  constructor(
    @Inject(OPERATIONAL_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IOperationalSettingsService
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({
    summary:
      'Read the effective sweep budgets and deletion-audit cadence, each with the rung that produced it, plus the accepted bounds',
  })
  @ApiResponse({ status: 200, type: OperationalSettingsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async get(@Res({ passthrough: true }) res: Response): Promise<OperationalSettingsResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    return OperationalSettingsResponseDto.fromView(await this.settings.resolve());
  }

  @Roles('admin')
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Update one or more values. An omitted field is left alone; an explicit null clears it back to the env-or-default rung.',
  })
  @ApiResponse({ status: 204, description: 'Settings updated' })
  @ApiResponse({
    status: 400,
    description:
      'A value is below the minimum, above the absolute ceiling, or above the recommended ceiling without `acknowledgeAboveRecommended`; or the cadence is unusable. The message names the field, the ceiling and why it sits there.',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async update(
    @Body() dto: UpdateOperationalSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.withDomainExceptionMapping(() =>
      this.settings.updateSettings(
        {
          catalogueSweepBudget: dto.catalogueSweepBudget,
          inventorySweepBudget: dto.inventorySweepBudget,
          sweepPageSize: dto.sweepPageSize,
          deletionAuditBudget: dto.deletionAuditBudget,
          deletionAuditCadence: dto.deletionAuditCadence,
          acknowledgeAboveRecommended: dto.acknowledgeAboveRecommended,
        },
        user?.id ?? null
      )
    );
  }

  private async withDomainExceptionMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof InvalidOperationalSettingError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
