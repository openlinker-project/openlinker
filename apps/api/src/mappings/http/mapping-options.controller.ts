/**
 * Mapping Options Controller (#472 / #473 / #474 / #479)
 *
 * Capability-scoped routes for the carrier-mapping UI dropdowns. Each handler
 * resolves the platform adapter via `IIntegrationsService.getCapabilityAdapter`,
 * narrows it through the appropriate type guard
 * (`isDestinationOptionsReader` / `isSourceOptionsReader`), and returns the
 * live `MappingOption[]` list. Adapters that don't implement the relevant
 * sub-capability cause a `501 Not Implemented`; FE renders an empty dropdown
 * with a clear message.
 *
 * Replaces the eight legacy platform-prefixed routes (`allegro/*`,
 * `prestashop/*`) and the seven hardcoded option constants. The routes drop
 * the platform prefix from the URL because `connectionId` already
 * disambiguates the platform via `ConnectionService`.
 *
 * #479 — Partner resolution. The Allegro→PrestaShop mappings page lives at
 * `/connections/{connectionId}/mappings` and renders source options from the
 * Allegro connection plus destination options from its PrestaShop partner.
 * Source and destination capabilities live on different connections, so the
 * URL `connectionId` is mapped to the partner via `Connection.config.master
 * CatalogConnectionId` before each `getCapabilityAdapter` call.
 *
 * Categories endpoints continue to use `categoriesCacheService` directly —
 * they're already live-data and the cache is the right architecture for
 * tree-structured taxonomies; only the URL changed.
 *
 * Every route here is a read-only `@Get`, so the class-level `@Roles` is
 * relaxed to admin/operator/viewer (#1652) — a demo viewer can browse the
 * bulk-offer-wizard category tree and other mapping-option dropdowns without
 * a 403.
 *
 * @module apps/api/src/mappings/http
 */

import {
  Controller,
  Get,
  Param,
  Query,
  Inject,
  NotImplementedException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  CONNECTION_PORT_TOKEN,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import {
  isDestinationOptionsReader,
  isSourceOptionsReader,
  type DestinationOptionsReader,
  type OrderProcessorManagerPort,
  type OrderSourcePort,
  type SourceOptionsReader,
} from '@openlinker/core/orders';

import { Roles } from '../../auth/decorators/roles.decorator';
import { MappingOptionResponseDto } from './dto/mapping-option-response.dto';
import { AllegroCategoryResponseDto } from './dto/allegro-category-response.dto';
import { CategoryPathNodeResponseDto } from './dto/category-path-node-response.dto';
import { ICategoriesCacheService } from '../../categories/categories-cache.service.interface';
import { CATEGORIES_CACHE_SERVICE_TOKEN } from '../../categories/categories.tokens';

/**
 * Mapping-page partner platforms. The mappings UI is Allegro→PrestaShop only
 * today (FE labels say "Allegro status" → "PrestaShop status"). When a third
 * platform pair (Shopify→PS, etc.) gets added, this branching grows; for now
 * the literals match the de-facto convention used elsewhere in the codebase
 * (`Connection.platformType` is `string` per connection.types.ts:15 — once a
 * `PlatformTypeValues as const` lands per engineering-standards.md, swap
 * these literals for the constant references).
 */
const PLATFORM_ALLEGRO = 'allegro';
const PLATFORM_PRESTASHOP = 'prestashop';

type ResolvedSide = 'source' | 'destination';

@Roles('admin', 'operator', 'viewer')
@ApiBearerAuth()
@ApiTags('mappings')
@Controller('connections/:connectionId/mappings/options')
export class MappingOptionsController {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(CATEGORIES_CACHE_SERVICE_TOKEN)
    private readonly categoriesCacheService: ICategoriesCacheService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort
  ) {}

  // ── Destination side (e.g. PrestaShop OrderProcessorManager) ────────────

  @Get('destination/carriers')
  @ApiOperation({ summary: 'List destination-platform carriers (live)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 400, description: 'No PrestaShop partner is paired with this connection' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement DestinationOptionsReader' })
  async getDestinationCarriers(
    @Param('connectionId') connectionId: string
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveDestinationOptions(connectionId, 'listCarriers');
  }

  @Get('destination/order-statuses')
  @ApiOperation({ summary: 'List destination-platform order statuses (live)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 400, description: 'No PrestaShop partner is paired with this connection' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement DestinationOptionsReader' })
  async getDestinationOrderStatuses(
    @Param('connectionId') connectionId: string
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveDestinationOptions(connectionId, 'listOrderStatuses');
  }

  @Get('destination/payment-methods')
  @ApiOperation({ summary: 'List destination-platform payment methods (live)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 400, description: 'No PrestaShop partner is paired with this connection' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement DestinationOptionsReader' })
  async getDestinationPaymentMethods(
    @Param('connectionId') connectionId: string
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveDestinationOptions(connectionId, 'listPaymentMethods');
  }

  // ── Source side (e.g. Allegro OrderSource) ──────────────────────────────

  @Get('source/order-statuses')
  @ApiOperation({ summary: 'List source-platform order statuses' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 400, description: 'No Allegro partner is paired with this connection' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement SourceOptionsReader' })
  async getSourceOrderStatuses(
    @Param('connectionId') connectionId: string
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveSourceOptions(connectionId, 'listOrderStatuses');
  }

  @Get('source/delivery-methods')
  @ApiOperation({ summary: 'List source-platform delivery methods (carriers, with human labels)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 400, description: 'No Allegro partner is paired with this connection' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement SourceOptionsReader' })
  async getSourceDeliveryMethods(
    @Param('connectionId') connectionId: string
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveSourceOptions(connectionId, 'listDeliveryMethods');
  }

  @Get('source/payment-methods')
  @ApiOperation({ summary: 'List source-platform payment methods' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 400, description: 'No Allegro partner is paired with this connection' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement SourceOptionsReader' })
  async getSourcePaymentMethods(
    @Param('connectionId') connectionId: string
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveSourceOptions(connectionId, 'listPaymentMethods');
  }

  // ── Categories (live, cached — different architecture from option lists) ─

  @Get('destination/categories')
  @ApiOperation({ summary: 'List destination-platform categories (live, cached)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, description: 'Array of platform categories' })
  async getDestinationCategories(@Param('connectionId') connectionId: string): Promise<unknown[]> {
    return this.categoriesCacheService.getPrestashopCategories(connectionId);
  }

  @Get('source/categories')
  @ApiOperation({ summary: 'Browse source-platform category tree (cached, 24h TTL)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiQuery({
    name: 'parentId',
    required: false,
    type: String,
    description: 'Parent category ID (omit for root)',
  })
  @ApiResponse({ status: 200, type: [AllegroCategoryResponseDto] })
  async getSourceCategories(
    @Param('connectionId') connectionId: string,
    @Query('parentId') parentId?: string
  ): Promise<AllegroCategoryResponseDto[]> {
    const categories = await this.categoriesCacheService.getAllegroCategories(
      connectionId,
      parentId
    );
    return categories.map((c) => AllegroCategoryResponseDto.fromDomain(c));
  }

  @Get('source/categories/:categoryId/path')
  @ApiOperation({
    summary: 'Resolve a source-platform category id to its root-to-leaf breadcrumb (#1741)',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiParam({ name: 'categoryId', type: String })
  @ApiResponse({ status: 200, type: [CategoryPathNodeResponseDto] })
  async getSourceCategoryPath(
    @Param('connectionId') connectionId: string,
    @Param('categoryId') categoryId: string
  ): Promise<CategoryPathNodeResponseDto[]> {
    const path = await this.categoriesCacheService.getAllegroCategoryPath(connectionId, categoryId);
    return path.map((n) => CategoryPathNodeResponseDto.fromDomain(n));
  }

  // ── Private helpers (#472 §5.5 / #479) ──────────────────────────────────

  /**
   * Resolves the destination adapter, narrows via `isDestinationOptionsReader`,
   * and invokes the named method. Centralises the resolve+narrow+invoke
   * pattern that would otherwise repeat across three near-identical handlers.
   *
   * #479: the URL `connectionId` may be the Allegro source connection — in
   * that case `resolvePartnerConnectionId` returns its paired PrestaShop id,
   * which is the connection that actually carries the OrderProcessorManager
   * capability.
   */
  private async resolveDestinationOptions<K extends keyof DestinationOptionsReader>(
    connectionId: string,
    method: K
  ): Promise<MappingOptionResponseDto[]> {
    const partnerConnectionId = await this.resolvePartnerConnectionId(connectionId, 'destination');
    const adapter = await this.integrationsService.getCapabilityAdapter<OrderProcessorManagerPort>(
      partnerConnectionId,
      'OrderProcessorManager'
    );
    if (!isDestinationOptionsReader(adapter)) {
      throw new NotImplementedException(
        `Adapter for connection ${partnerConnectionId} does not implement DestinationOptionsReader`
      );
    }
    return adapter[method]();
  }

  /**
   * Source-side counterpart to `resolveDestinationOptions`. Same shape, but
   * resolves `OrderSourcePort` and narrows via `isSourceOptionsReader`.
   */
  private async resolveSourceOptions<K extends keyof SourceOptionsReader>(
    connectionId: string,
    method: K
  ): Promise<MappingOptionResponseDto[]> {
    const partnerConnectionId = await this.resolvePartnerConnectionId(connectionId, 'source');
    const adapter = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
      partnerConnectionId,
      'OrderSource'
    );
    if (!isSourceOptionsReader(adapter)) {
      throw new NotImplementedException(
        `Adapter for connection ${partnerConnectionId} does not implement SourceOptionsReader`
      );
    }
    return adapter[method]();
  }

  /**
   * Map the URL connection to the connection that actually carries the
   * requested side's capability. The mappings page is hard-coded
   * Allegro→PrestaShop today; the pairing is stored on the Allegro
   * connection's `config.masterCatalogConnectionId` (set during OAuth).
   *
   * Resolution table:
   *
   * | URL platform | side          | Returns                                                |
   * |--------------|---------------|--------------------------------------------------------|
   * | allegro      | source        | URL connection                                         |
   * | allegro      | destination   | `config.masterCatalogConnectionId` on URL connection   |
   * | prestashop   | source        | the active Allegro whose `masterCatalogConnectionId` matches the URL id |
   * | prestashop   | destination   | URL connection                                         |
   * | other        | either        | 400 (unsupported platform)                             |
   *
   * Throws `BadRequestException` (NOT 501/404) for "no partner configured"
   * and "ambiguous partner" — these are operator-input issues, not server
   * faults, and the FE alert should point the operator at the connection-
   * edit page rather than leaking internal capability terminology.
   */
  private async resolvePartnerConnectionId(
    urlConnectionId: string,
    side: ResolvedSide
  ): Promise<string> {
    // ConnectionPort.get throws ConnectionNotFoundException for unknown ids;
    // that propagates through Nest as a 404 — existing behaviour.
    const url = await this.connectionPort.get(urlConnectionId);

    if (url.platformType === PLATFORM_ALLEGRO) {
      if (side === 'source') {
        return url.id;
      }
      const partnerId = readMasterCatalogConnectionId(url);
      if (!partnerId) {
        throw new BadRequestException(
          `Connection "${url.name}" (${shortId(url.id)}) has no destination paired. ` +
            `Set the catalog connection on the connection-edit page and try again.`
        );
      }
      return partnerId;
    }

    if (url.platformType === PLATFORM_PRESTASHOP) {
      if (side === 'destination') {
        return url.id;
      }
      // Reverse lookup: find the Allegro connection that points at this PS
      // via `config.masterCatalogConnectionId`. Filter by `status: 'active'`
      // because a disabled or errored Allegro pairing isn't a real partner —
      // the mappings page would then call `getCapabilityAdapter` against it
      // and fail downstream anyway.
      // TODO(#479): when `ConnectionFilters` grows a `configKeyEquals` shape,
      // push the filter into the repository instead of fetching all active
      // Allegro connections and filtering in code.
      const candidates = await this.connectionPort.list({
        platformType: PLATFORM_ALLEGRO,
        status: 'active',
      });
      const paired = candidates.filter((c) => readMasterCatalogConnectionId(c) === url.id);
      if (paired.length === 0) {
        throw new BadRequestException(
          `Connection "${url.name}" (${shortId(url.id)}) has no source paired. ` +
            `Open the Allegro connection's edit page and set its catalog to this PrestaShop connection.`
        );
      }
      if (paired.length > 1) {
        const ids = paired.map((c) => c.id).join(', ');
        throw new BadRequestException(
          `Connection "${url.name}" (${shortId(url.id)}) has multiple paired Allegro connections (${ids}). ` +
            `Multi-source mapping is not yet supported — disable the duplicates on the connection-edit page.`
        );
      }
      const [only] = paired;
      return only.id;
    }

    throw new BadRequestException(
      `Connection "${url.name}" (${shortId(url.id)}) has unsupported platform "${url.platformType}" for the mappings page. ` +
        `Today the mappings page is Allegro→PrestaShop only.`
    );
  }
}

/**
 * Pull `masterCatalogConnectionId` off a connection's `config` JSONB.
 * Returns `undefined` for any non-string / empty value so the caller can
 * treat "missing" and "garbage" identically.
 */
function readMasterCatalogConnectionId(connection: Connection): string | undefined {
  const value = connection.config?.['masterCatalogConnectionId'];
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

/** Short prefix for human-readable error messages. UUIDs alone don't help operators self-serve. */
function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}
