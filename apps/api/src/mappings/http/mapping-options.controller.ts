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
import { ICategoriesCacheService } from '../../categories/categories-cache.service.interface';
import { CATEGORIES_CACHE_SERVICE_TOKEN } from '../../categories/categories.tokens';

/**
 * Capabilities the resolved partner must advertise per side (#1738). Checked
 * against adapter metadata (a metadata-only `getAdapter` lookup) so the
 * resolution is capability-driven — no `platformType` literals — and a
 * connection that can never serve the requested side fails with a clean 400
 * instead of a downstream capability-gate error.
 */
const SOURCE_CAPABILITY = 'OrderSource';
const DESTINATION_CAPABILITY = 'OrderProcessorManager';

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
   * requested side's capability. Pairing-first + capability-checked (#1738 —
   * previously a hard-coded Allegro→PrestaShop platform switch): the pairing
   * key is `config.masterCatalogConnectionId`, stamped on every marketplace /
   * shop connection that points at a master (Allegro, Erli, WooCommerce).
   *
   * Resolution table:
   *
   * | URL connection            | side        | Returns                                            |
   * |---------------------------|-------------|-----------------------------------------------------|
   * | has pairing key (source)  | source      | URL connection (must advertise OrderSource)         |
   * | has pairing key (source)  | destination | the paired master from the pairing key              |
   * | no pairing key (master)   | source      | the single active OrderSource paired at the URL id  |
   * | no pairing key (master)   | destination | URL connection (must advertise OrderProcessorManager) |
   *
   * Throws `BadRequestException` (NOT 501/404) for "no partner configured",
   * "ambiguous partner", and "capability missing" — operator-input issues, not
   * server faults; the FE alert should point at the connection-edit page.
   */
  private async resolvePartnerConnectionId(
    urlConnectionId: string,
    side: ResolvedSide
  ): Promise<string> {
    // ConnectionPort.get throws ConnectionNotFoundException for unknown ids;
    // that propagates through Nest as a 404 — existing behaviour.
    const url = await this.connectionPort.get(urlConnectionId);
    const pairedMasterId = readMasterCatalogConnectionId(url);

    if (side === 'source') {
      if (pairedMasterId) {
        // The URL connection points at a master, so it IS the order source.
        await this.assertAdvertisesCapability(url, SOURCE_CAPABILITY);
        return url.id;
      }
      // The URL connection is a master/destination: reverse-lookup the single
      // active source paired to it. Filter by `status: 'active'` because a
      // disabled pairing isn't a real partner, and by advertised capability so
      // a paired non-source (another shop syncing the same catalog) is never
      // offered as the source.
      // TODO(#479): when `ConnectionFilters` grows a `configKeyEquals` shape,
      // push the pairing filter into the repository.
      const candidates = await this.connectionPort.list({ status: 'active' });
      const pairedHere = candidates.filter((c) => readMasterCatalogConnectionId(c) === url.id);
      const paired: Connection[] = [];
      for (const candidate of pairedHere) {
        if (await this.advertisesCapability(candidate.id, SOURCE_CAPABILITY)) {
          paired.push(candidate);
        }
      }
      if (paired.length === 0) {
        throw new BadRequestException(
          `Connection "${url.name}" (${shortId(url.id)}) has no source paired. ` +
            `Open the marketplace connection's edit page and set its catalog to this connection.`
        );
      }
      if (paired.length > 1) {
        const ids = paired.map((c) => c.id).join(', ');
        throw new BadRequestException(
          `Connection "${url.name}" (${shortId(url.id)}) has multiple paired source connections (${ids}). ` +
            `Open the mappings page from the source connection you want to configure.`
        );
      }
      const [only] = paired;
      return only.id;
    }

    // side === 'destination'
    if (pairedMasterId) {
      return pairedMasterId;
    }
    // No pairing key — the URL connection must itself be the destination.
    await this.assertAdvertisesCapability(url, DESTINATION_CAPABILITY);
    return url.id;
  }

  /**
   * Metadata-only capability probe (`getAdapter` constructs no adapter
   * instance — same lookup `FulfillmentRoutingService` uses for candidate
   * enumeration). Returns `false` when the metadata can't be resolved (stale
   * adapterKey / removed plugin) rather than failing the whole resolution.
   */
  private async advertisesCapability(connectionId: string, capability: string): Promise<boolean> {
    try {
      const { metadata } = await this.integrationsService.getAdapter(connectionId);
      return metadata.supportedCapabilities.includes(capability);
    } catch {
      return false;
    }
  }

  /**
   * 400 with an operator-facing message when the connection can't serve the
   * side. Unlike `advertisesCapability`, lifecycle exceptions from `getAdapter`
   * (ConnectionNotFound → 404, ConnectionDisabled → 409 via the global
   * `ConnectionExceptionFilter`) propagate unchanged — only a genuinely
   * missing capability maps to 400.
   */
  private async assertAdvertisesCapability(
    connection: Connection,
    capability: string
  ): Promise<void> {
    const { metadata } = await this.integrationsService.getAdapter(connection.id);
    if (!metadata.supportedCapabilities.includes(capability)) {
      throw new BadRequestException(
        `Connection "${connection.name}" (${shortId(connection.id)}) does not support ${capability}, ` +
          `so it cannot serve this side of the mappings page.`
      );
    }
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
