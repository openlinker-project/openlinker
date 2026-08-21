/**
 * Catalog Trust Controller
 *
 * HTTP REST API endpoint for the per-connection catalog-trust read (#2258):
 * the declared master capability rung, delta-pass enablement, and deletion-
 * reconciliation recency. Read-only, rendered on the connection detail page.
 *
 * Nested route prefix rather than a second bare @Controller('connections') —
 * the integrations module owns that prefix, and a duplicate would be a Nest
 * route-resolution ambiguity (the mappings module's nested precedent).
 *
 * The 404 deliberately conflates "connection does not exist" with
 * "connection lacks the ProductMaster capability": both mean the read is not
 * applicable, the FE gates the panel on `enabledCapabilities`, and
 * distinguishing would cost a second read for nothing.
 *
 * @module apps/api/src/catalog-trust/http
 */
import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { ConnectionCatalogTrust } from '@openlinker/core/catalog-trust';
import { CATALOG_TRUST_SERVICE_TOKEN, ICatalogTrustService } from '@openlinker/core/catalog-trust';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CatalogTrustResponseDto } from '../dto/catalog-trust-response.dto';

@ApiBearerAuth()
@ApiTags('catalog-trust')
@Controller('connections/:connectionId/catalog-trust')
export class CatalogTrustController {
  constructor(
    @Inject(CATALOG_TRUST_SERVICE_TOKEN)
    private readonly catalogTrustService: ICatalogTrustService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: "Get a ProductMaster connection's catalog-trust facts",
    description:
      'Reports which capability rung the master is on (guard-narrowed from the dispatched ' +
      'adapter, never a manifest name), whether the opt-in delta pass is enabled, and when the ' +
      'deletion-reconciliation pass last completed a cycle. 404 when the connection does not ' +
      'exist or has no ProductMaster capability enabled.',
  })
  @ApiResponse({ status: 200, type: CatalogTrustResponseDto })
  @ApiResponse({ status: 404, description: 'Connection not found or not a ProductMaster' })
  async getCatalogTrust(
    @Param('connectionId') connectionId: string
  ): Promise<CatalogTrustResponseDto> {
    const trust = await this.catalogTrustService.getConnectionCatalogTrust(connectionId);
    if (trust === null) {
      throw new NotFoundException(
        `Connection ${connectionId} not found or has no ProductMaster capability`
      );
    }
    return this.toResponseDto(trust);
  }

  private toResponseDto(trust: ConnectionCatalogTrust): CatalogTrustResponseDto {
    const dto = new CatalogTrustResponseDto();
    dto.connectionId = trust.connectionId;
    dto.rung = trust.rung;
    dto.deltaPassEnabled = trust.deltaPassEnabled;
    dto.lastReconcileCompletedAt = trust.lastReconcileCompletedAt
      ? trust.lastReconcileCompletedAt.toISOString()
      : null;
    dto.reconcileCycleOpen = trust.reconcileCycleOpen;
    return dto;
  }
}
