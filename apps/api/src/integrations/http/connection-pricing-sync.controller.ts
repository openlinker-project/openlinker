/**
 * Connection Pricing & Sync Controller (#3146, ADR-072)
 *
 * `GET`/`PATCH /connections/:id/pricing-sync` (write is `@Roles('admin')` —
 * matching every other `ConnectionController` write, since this PATCHes
 * `Connection.config`) and the READ-ONLY
 * `GET /connections/:id/pricing-sync/as-source` (ADR-072 decision 2 — no
 * PATCH variant exists for that route, by design).
 *
 * `sourceOverrides` validation is declarative (`@ValidateSourceOverrides` on
 * `UpdatePricingSyncDto`, reached through the ordinary global `ValidationPipe`)
 * rather than a manual per-entry loop in this controller (#3163 review,
 * finding 8) — see `validate-source-overrides.decorator.ts`.
 *
 * @module apps/api/src/integrations/http
 */
import { Controller, Get, Inject, Param, Patch, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CONNECTION_PRICING_SYNC_SERVICE_TOKEN,
  type IConnectionPricingSyncService,
} from '../application/interfaces/connection-pricing-sync.service.interface';
import { UpdatePricingSyncDto } from './dto/update-pricing-sync.dto';
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
  @ApiResponse({ status: 400, description: 'A rule/mode entry does not match the accepted shapes, or the connection cannot be a pricing destination.' })
  @ApiResponse({ status: 409, description: 'A concurrent write was detected (lock contention, or a stale `expectedUpdatedAt`).' })
  async update(
    @Param('connectionId') connectionId: string,
    @Body() dto: UpdatePricingSyncDto
  ): Promise<ConnectionPricingSyncResponseDto> {
    const view = await this.pricingSync.updatePricingSync(connectionId, {
      default: dto.default,
      sourceOverrides: dto.sourceOverrides ?? {},
      expectedUpdatedAt: dto.expectedUpdatedAt,
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
}
