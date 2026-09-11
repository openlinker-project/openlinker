/**
 * Connection Pricing & Sync Controller (#3146, ADR-072)
 *
 * `GET`/`PATCH /connections/:id/pricing-sync` (write is `@Roles('admin')` —
 * matching every other `ConnectionController` write, since this PATCHes
 * `Connection.config`) and the READ-ONLY
 * `GET /connections/:id/pricing-sync/as-source` (ADR-072 decision 2 — no
 * PATCH variant exists for that route, by design).
 *
 * @module apps/api/src/integrations/http
 */
import { BadRequestException, Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CONNECTION_PRICING_SYNC_SERVICE_TOKEN,
  type IConnectionPricingSyncService,
} from '../application/interfaces/connection-pricing-sync.service.interface';
import { UpdatePricingSyncDto } from './dto/update-pricing-sync.dto';
import { PricingSyncSettingDto } from './dto/pricing-sync-setting.dto';
import {
  ConnectionAsSourceEntryResponseDto,
  ConnectionPricingSyncResponseDto,
} from './dto/connection-pricing-sync-response.dto';

@ApiTags('connections')
@ApiBearerAuth()
@Controller('connections/:connectionId/pricing-sync')
export class ConnectionPricingSyncController {
  constructor(
    @Inject(CONNECTION_PRICING_SYNC_SERVICE_TOKEN)
    private readonly pricingSync: IConnectionPricingSyncService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: "A destination connection's default + per-source pricing rule and sync mode." })
  @ApiResponse({ status: 200, type: ConnectionPricingSyncResponseDto })
  async get(@Param('connectionId') connectionId: string): Promise<ConnectionPricingSyncResponseDto> {
    const view = await this.pricingSync.getPricingSync(connectionId);
    return ConnectionPricingSyncResponseDto.fromDomain(view);
  }

  @Patch()
  @Roles('admin')
  @ApiOperation({ summary: 'Save the default + per-source pricing rule and sync mode (explicit-Save, no partial patch).' })
  @ApiResponse({ status: 200, type: ConnectionPricingSyncResponseDto })
  @ApiResponse({ status: 400, description: 'A rule/mode entry does not match the accepted shapes.' })
  async update(
    @Param('connectionId') connectionId: string,
    @Body() dto: UpdatePricingSyncDto
  ): Promise<ConnectionPricingSyncResponseDto> {
    const sourceOverrides = await this.validateSourceOverrides(dto.sourceOverrides ?? {});
    const view = await this.pricingSync.updatePricingSync(connectionId, {
      default: dto.default,
      sourceOverrides,
    });
    return ConnectionPricingSyncResponseDto.fromDomain(view);
  }

  @Get('as-source')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary:
      'READ-ONLY rollup: every destination this connection feeds, and how each adjusts its price (ADR-072 decision 2 — no write path).',
  })
  @ApiResponse({ status: 200, type: [ConnectionAsSourceEntryResponseDto] })
  async asSource(
    @Param('connectionId') connectionId: string
  ): Promise<ConnectionAsSourceEntryResponseDto[]> {
    const entries = await this.pricingSync.getAsSource(connectionId);
    return entries.map((entry) => ConnectionAsSourceEntryResponseDto.fromDomain(entry));
  }

  /**
   * `sourceOverrides` is a `Record<string, T>` — class-validator has no
   * first-class nested decorator for that shape, so each entry is validated
   * the same way `plainToInstance` + `validate()` would under `@ValidateNested`,
   * naming the OFFENDING SOURCE ID in the 400 rather than a generic error.
   */
  private async validateSourceOverrides(
    raw: Record<string, PricingSyncSettingDto>
  ): Promise<Record<string, PricingSyncSettingDto>> {
    const result: Record<string, PricingSyncSettingDto> = {};
    for (const [sourceId, value] of Object.entries(raw)) {
      const instance = plainToInstance(PricingSyncSettingDto, value);
      const errors = await validate(instance);
      if (errors.length > 0) {
        throw new BadRequestException(
          `Invalid pricing/sync setting for source ${sourceId}: ${errors
            .map((e) => Object.values(e.constraints ?? {}).join(', '))
            .join('; ')}`
        );
      }
      result[sourceId] = instance;
    }
    return result;
  }
}
