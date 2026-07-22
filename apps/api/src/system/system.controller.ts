/**
 * System Controller
 *
 * Exposes GET /system/config — a public endpoint the frontend calls once
 * at startup to read server-driven flags (e.g. demoMode). No auth required
 * so the login page can read it before a session exists.
 *
 * @module apps/api/src/system
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { SYSTEM_SERVICE_TOKEN, type ISystemService } from './system.service.interface';
import type { SystemConfigDto } from './dto/system-config.dto';

@ApiTags('System')
@Controller('system')
export class SystemController {
  constructor(
    @Inject(SYSTEM_SERVICE_TOKEN)
    private readonly systemService: ISystemService,
  ) {}

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'Get server-driven runtime configuration' })
  async getConfig(): Promise<SystemConfigDto> {
    return this.systemService.getConfig();
  }
}
