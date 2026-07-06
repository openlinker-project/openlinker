/**
 * Pickup-Point Controller
 *
 * HTTP endpoints for the manual paczkomat picker (#766/#769): a live
 * provider-backed search (results write-through cached by id) and a fast by-id
 * cached read. Goes through `IPickupPointLookupService` — never the cache port
 * directly (repository/cache ports are banned cross-context in apps/**).
 * Any authenticated role + JWT (#1357).
 *
 * @module apps/api/src/shipping/http
 */
import {
  BadGatewayException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type FindPickupPointsQuery,
  type IPickupPointLookupService,
  PICKUP_POINT_LOOKUP_SERVICE_TOKEN,
  PickupPointFinderNotSupportedException,
} from '@openlinker/core/shipping';
import {
  CapabilityNotEnabledException,
  CapabilityNotSupportedException,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import { ListPickupPointsQueryDto } from './dto/list-pickup-points-query.dto';
import { PickupPointResponseDto } from './dto/pickup-point-response.dto';

@ApiBearerAuth()
@ApiTags('pickup-points')
@Controller('pickup-points')
export class PickupPointController {
  private readonly logger = new Logger(PickupPointController.name);

  constructor(
    @Inject(PICKUP_POINT_LOOKUP_SERVICE_TOKEN)
    private readonly lookup: IPickupPointLookupService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Search a connection's pickup points (live; results cached by id)" })
  @ApiResponse({ status: 200, type: [PickupPointResponseDto] })
  @ApiResponse({ status: 422, description: 'Connection has no pickup-point network' })
  @ApiResponse({ status: 502, description: 'Shipping provider rejected the points lookup' })
  async search(@Query() query: ListPickupPointsQueryDto): Promise<PickupPointResponseDto[]> {
    const find: FindPickupPointsQuery = {
      searchText: query.searchText,
      city: query.city,
      postalCode: query.postalCode,
      limit: query.limit,
    };
    try {
      const points = await this.lookup.search(query.connectionId, find);
      return points.map((point) => PickupPointResponseDto.fromDomain(point));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  // Connection-agnostic: paczkomat ids are a single national namespace, so the
  // cache key needs no connectionId. A miss returns 404 — there is no live
  // by-id fall-through (the finder is search-only); re-search to re-warm.
  @Get(':providerId')
  @ApiOperation({ summary: 'Get a cached pickup point by provider id' })
  @ApiResponse({ status: 200, type: PickupPointResponseDto })
  @ApiResponse({ status: 404, description: 'Point not in cache' })
  async getCached(@Param('providerId') providerId: string): Promise<PickupPointResponseDto> {
    const point = await this.lookup.getCachedPoint(providerId);
    if (!point) {
      throw new NotFoundException(`Pickup point not cached: ${providerId}`);
    }
    return PickupPointResponseDto.fromDomain(point);
  }

  /**
   * Map lookup errors to HTTP. "This connection can't service a pickup-point
   * lookup" — the finder sub-capability is absent, or the capability is
   * unsupported by the adapter / disabled on the connection — is a well-formed
   * request against an incapable connection → 422 (OL never reached a
   * provider). Anything else is an upstream provider/transport failure → 502,
   * so the picker never falls through to a bare 500.
   */
  private toHttpException(error: unknown): Error {
    if (
      error instanceof PickupPointFinderNotSupportedException ||
      error instanceof CapabilityNotSupportedException ||
      error instanceof CapabilityNotEnabledException
    ) {
      return new UnprocessableEntityException(error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Pickup-point search failed: ${message}`);
    return new BadGatewayException(message);
  }
}
