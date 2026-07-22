/**
 * Listings Controller
 *
 * HTTP REST API endpoints for offer mapping read operations, outbound offer
 * creation (202-async), offer-creation status polling, and seller-policy
 * lookup (cached). Validates connection + capability up front for create,
 * then delegates asynchronous orchestration to the worker via
 * `marketplace.offer.create`.
 *
 * @module apps/api/src/listings/http
 */
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';

import { Roles } from '../../auth/decorators/roles.decorator';
import {
  AdapterCapabilityNotSupportedException,
  CatalogProductNotFoundException,
  CategoryNotFoundException,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
  isCatalogProductReader,
  isCategoryParametersReader,
  isCategoryPathReader,
  isOfferReader,
  OfferNotFoundOnMarketplaceException,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  SELLER_POLICIES_SERVICE_TOKEN,
  RESPONSIBLE_PRODUCER_SERVICE_TOKEN,
  DELIVERY_PRICE_LIST_SERVICE_TOKEN,
  ICategoryResolutionService,
  IOfferCreationEnqueueService,
  ISellerPoliciesService,
  IResponsibleProducerService,
  IDeliveryPriceListService,
  OfferCreationRecordRepositoryPort,
  OfferMappingRepositoryPort,
} from '@openlinker/core/listings';
import type {
  CategoryParameter,
  CategoryPathSegment,
  OfferCreationRecord,
  OfferManagerPort,
} from '@openlinker/core/listings';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIntegrationsService } from '@openlinker/core/integrations';
import type { CoreEntityType, IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { PRODUCT_VARIANT_REPOSITORY_TOKEN } from '@openlinker/core/products';
import { ProductVariantRepositoryPort } from '@openlinker/core/products';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { JobEnqueuePort } from '@openlinker/core/sync';

import { ListOfferMappingsQueryDto } from './dto/list-offer-mappings-query.dto';
import { MarketplaceOfferResponseDto } from './dto/marketplace-offer-response.dto';
import { OfferMappingResponseDto } from './dto/offer-mapping-response.dto';
import { PaginatedOfferMappingsResponseDto } from './dto/paginated-offer-mappings-response.dto';
import { UpdateOfferFieldsDto, UpdateOfferFieldsResponseDto } from './dto/update-offer-fields.dto';
import {
  AutoMatchVariantsRequestDto,
  AutoMatchVariantsResponseDto,
} from './dto/auto-match-variants.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CreateOfferResponseDto } from './dto/create-offer-response.dto';
import { OfferCreationStatusResponseDto } from './dto/offer-creation-status-response.dto';
import { SellerPoliciesResponseDto } from './dto/seller-policies-response.dto';
import { ResponsibleProducersResponseDto } from './dto/responsible-producers-response.dto';
import { DeliveryPriceListsResponseDto } from './dto/delivery-price-lists-response.dto';
import type { CategoryParameterResponseDto } from './dto/category-parameter-response.dto';
import { CategoryParametersListResponseDto } from './dto/category-parameter-response.dto';
import { CategoryPathResponseDto } from './dto/category-path-response.dto';
import { ResolveCategoryRequestDto, ResolveCategoryResponseDto } from './dto/resolve-category.dto';
import {
  ResolveCategoryBatchRequestDto,
  ResolveCategoryBatchResponseDto,
} from './dto/resolve-category-batch.dto';
import type { FindProductsByBarcodeResponseDto } from './dto/catalog-product.dto';
import {
  CatalogProductResponseDto,
  FindProductsByBarcodeRequestDto,
  findProductsByBarcodeResponseSchema,
} from './dto/catalog-product.dto';

@ApiBearerAuth()
@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappingRepository: OfferMappingRepositoryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(OFFER_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly offerCreationRecords: OfferCreationRecordRepositoryPort,
    @Inject(OFFER_CREATION_ENQUEUE_SERVICE_TOKEN)
    private readonly offerCreationEnqueue: IOfferCreationEnqueueService,
    @Inject(SELLER_POLICIES_SERVICE_TOKEN)
    private readonly sellerPolicies: ISellerPoliciesService,
    @Inject(RESPONSIBLE_PRODUCER_SERVICE_TOKEN)
    private readonly responsibleProducers: IResponsibleProducerService,
    @Inject(DELIVERY_PRICE_LIST_SERVICE_TOKEN)
    private readonly deliveryPriceLists: IDeliveryPriceListService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)
    private readonly productVariantRepository: ProductVariantRepositoryPort,
    @Inject(CATEGORY_RESOLUTION_SERVICE_TOKEN)
    private readonly categoryResolution: ICategoryResolutionService
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List offer mappings',
    description:
      'Returns a paginated list of offer-to-variant mappings. Supports filtering by connectionId, platformType, internalId, and search on externalId.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated offer mappings list',
    type: PaginatedOfferMappingsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listOfferMappings(
    @Query() query: ListOfferMappingsQueryDto
  ): Promise<PaginatedOfferMappingsResponseDto> {
    const { connectionId, platformType, internalId, search, limit = 20, offset = 0 } = query;

    const { items, total } = await this.offerMappingRepository.findMany(
      { connectionId, platformType, internalId, search },
      { limit, offset }
    );

    return {
      items: items.map((m) => this.toDto(m)),
      total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Offer mapping row ID (UUID)' })
  @ApiOperation({ summary: 'Get offer mapping by ID' })
  @ApiResponse({ status: 200, description: 'Offer mapping detail', type: OfferMappingResponseDto })
  @ApiResponse({ status: 404, description: 'Offer mapping not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getOfferMapping(
    @Param('id', new ParseUUIDPipe()) id: string
  ): Promise<OfferMappingResponseDto> {
    const mapping = await this.offerMappingRepository.findById(id);
    if (!mapping) {
      throw new NotFoundException(`Offer mapping not found: ${id}`);
    }

    const dto = this.toDto(mapping);
    // Enrich Offer-type mappings with two independent lookups in parallel:
    //   - the matching OfferCreationRecord (so the detail page can show
    //     creation status + errors for OL-initiated offers without a second
    //     round-trip — synced-in offers fall through to a plain DTO),
    //   - the linked variant's productId (drives the AI-suggest flow on the
    //     edit drawer — #485 — which is keyed on product, not variant).
    // Non-Offer entity types skip both lookups entirely.
    if (mapping.entityType === ('Offer' satisfies CoreEntityType)) {
      const [record, linkedVariant] = await Promise.all([
        this.offerCreationRecords.findByExternalOfferIdAndConnectionId(
          mapping.externalId,
          mapping.connectionId
        ),
        this.productVariantRepository.findById(mapping.internalId),
      ]);
      if (record) {
        dto.offerCreation = this.toOfferCreationStatusDto(record);
      }
      if (linkedVariant) {
        dto.linkedProductId = linkedVariant.productId;
      }
    }
    return dto;
  }

  @Get(':id/offer')
  @HttpCode(HttpStatus.OK)
  // 30 s cache lets quick back-and-forth navigation between the listings
  // list and the detail page reuse a single Allegro fetch — `staleTime` on
  // the FE query mirrors the same window. Keep `public` because the response
  // carries no per-user state (everything is connection-scoped marketplace
  // data the operator can already see in the UI).
  @Header('Cache-Control', 'public, max-age=30')
  @ApiParam({ name: 'id', description: 'Offer mapping row ID (UUID)' })
  @ApiOperation({
    summary: 'Get live marketplace offer for an offer mapping (#464)',
    description:
      'Fetches the live marketplace-side offer (title, image, price, qty, status, …) referenced by an `entityType=Offer` mapping. Resolves the connection\'s `OfferManagerPort` and requires it to implement the `OfferReader` sub-capability; adapters that do not are surfaced as 422 so the FE can render a soft "live data unavailable" fallback while the rest of the page (raw mapping fields, OfferCreation status) keeps rendering.',
  })
  @ApiResponse({ status: 200, description: 'Live offer detail', type: MarketplaceOfferResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Offer mapping not found, or mapping is not of `entityType=Offer`',
  })
  @ApiResponse({
    status: 422,
    description: 'Adapter for this connection does not implement `OfferReader`',
  })
  async getMarketplaceOffer(
    @Param('id', new ParseUUIDPipe()) id: string
  ): Promise<MarketplaceOfferResponseDto> {
    const mapping = await this.offerMappingRepository.findById(id);
    if (!mapping) {
      throw new NotFoundException(`Offer mapping not found: ${id}`);
    }
    // Treat non-Offer mappings as 404 rather than a separate 4xx — the
    // existence of the mapping isn't actionable for the live-offer surface
    // and the response shape is identical to "mapping doesn't exist".
    if (mapping.entityType !== ('Offer' satisfies CoreEntityType)) {
      throw new NotFoundException(
        `Offer mapping ${id} is not of entityType=Offer (got: ${mapping.entityType})`
      );
    }

    // Connection-level errors (404 / 409) propagate from getCapabilityAdapter
    // unchanged via Nest's exception filter — same convention as
    // getCategoryParameters above.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      mapping.connectionId,
      'OfferManager'
    );

    if (!isOfferReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${mapping.connectionId} does not support live offer reading`
      );
    }

    try {
      const offer = await adapter.getOffer({ externalId: mapping.externalId });
      return MarketplaceOfferResponseDto.fromDomain(offer);
    } catch (error) {
      // The offer isn't (yet) retrievable on the marketplace — e.g. Erli's
      // read-after-write cache lag or a deleted offer. Map to 404 so the FE
      // renders the soft "live data unavailable" fallback rather than a hard
      // error, keeping the rest of the detail page rendering.
      if (error instanceof OfferNotFoundOnMarketplaceException) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Roles('admin', 'operator')
  @Post('connections/:connectionId/offers/:offerId/fields')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'connectionId', description: 'Connection ID' })
  @ApiParam({ name: 'offerId', description: 'Internal OpenLinker offer ID' })
  @ApiOperation({
    summary: 'Update offer fields',
    description:
      'Dispatches an async job to update Allegro offer fields (price, title, description). At least one field must be provided. Returns 202 Accepted with a job ID.',
  })
  @ApiResponse({
    status: 202,
    description: 'Update job dispatched',
    type: UpdateOfferFieldsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error — no fields provided or invalid values',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async updateOfferFields(
    @Param('connectionId') connectionId: string,
    @Param('offerId') offerId: string,
    @Body() dto: UpdateOfferFieldsDto,
    @Headers('x-idempotency-key') clientIdempotencyKey?: string
  ): Promise<UpdateOfferFieldsResponseDto> {
    const { jobId } = await this.jobEnqueue.enqueueJob({
      jobType: 'marketplace.offer.updateFields',
      connectionId,
      idempotencyKey: clientIdempotencyKey ?? randomUUID(),
      payload: {
        schemaVersion: 1,
        offerId,
        fields: {
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
        },
      },
    });

    return { jobId };
  }

  @Roles('admin', 'operator')
  @Post('connections/:connectionId/sync/auto-match-variants')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID (e.g., Allegro)' })
  @ApiOperation({
    summary: 'Auto-match variants to offers',
    description:
      'Dispatches a background job that matches PrestaShop product variants to marketplace offers by EAN/SKU. Returns 202 Accepted with a job ID.',
  })
  @ApiResponse({
    status: 202,
    description: 'Auto-match job dispatched',
    type: AutoMatchVariantsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async autoMatchVariants(
    @Param('connectionId') connectionId: string,
    @Body() dto: AutoMatchVariantsRequestDto,
    @Headers('x-idempotency-key') clientIdempotencyKey?: string
  ): Promise<AutoMatchVariantsResponseDto> {
    const { jobId } = await this.jobEnqueue.enqueueJob({
      jobType: 'master.variants.autoMatch',
      connectionId,
      idempotencyKey: clientIdempotencyKey ?? `auto-match-variants:${connectionId}:${randomUUID()}`,
      payload: {
        schemaVersion: 1,
        dryRun: dto.dryRun ?? false,
      },
    });

    return { jobId };
  }

  @Roles('admin', 'operator')
  @Post('connections/:connectionId/offers')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiOperation({
    summary: 'Create a marketplace offer from an OpenLinker variant',
    description:
      'Validates the connection and adapter capability, pre-creates an OfferCreationRecord (status=pending), and enqueues a marketplace.offer.create job. Poll GET /listings/connections/:connectionId/offers/creation/:offerCreationRecordId for lifecycle updates.',
  })
  @ApiResponse({
    status: 202,
    description: 'Creation job dispatched',
    type: CreateOfferResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support offer creation' })
  async createOffer(
    @Param('connectionId') connectionId: string,
    @Body() dto: CreateOfferDto,
    @Headers('x-idempotency-key') clientIdempotencyKey?: string
  ): Promise<CreateOfferResponseDto> {
    // All orchestration (adapter resolution, capability check, record
    // creation, job enqueue) lives in the core application service so the
    // worker's `OfferCreationExecutionService` sibling has a matching
    // pre-enqueue counterpart. Exceptions propagate unchanged — Nest maps
    // ConnectionNotFoundException → 404, ConnectionDisabledException → 409,
    // Capability* → 422, UnprocessableEntityException → 422.
    const { jobId, offerCreationRecord } = await this.offerCreationEnqueue.enqueueCreation({
      internalVariantId: dto.internalVariantId,
      connectionId,
      stock: dto.stock,
      publishImmediately: dto.publishImmediately,
      price: dto.price,
      overrides: dto.overrides,
      idempotencyKey: clientIdempotencyKey,
    });

    return { jobId, offerCreationRecordId: offerCreationRecord.id };
  }

  @Get('connections/:connectionId/offers/creation/:offerCreationRecordId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiParam({
    name: 'offerCreationRecordId',
    description: 'OfferCreationRecord id returned by POST /offers',
  })
  @ApiOperation({ summary: 'Get offer-creation record status' })
  @ApiResponse({ status: 200, description: 'Record detail', type: OfferCreationStatusResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Record not found or belongs to a different connection',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getOfferCreationStatus(
    @Param('connectionId') connectionId: string,
    @Param('offerCreationRecordId', new ParseUUIDPipe()) offerCreationRecordId: string
  ): Promise<OfferCreationStatusResponseDto> {
    const record = await this.offerCreationRecords.findById(offerCreationRecordId);
    if (!record || record.connectionId !== connectionId) {
      // Cross-connection lookups return 404 to avoid leaking record existence.
      throw new NotFoundException(`Offer creation record not found: ${offerCreationRecordId}`);
    }
    return this.toOfferCreationStatusDto(record);
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('connections/:connectionId/seller-policies')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiOperation({
    summary: 'List seller-configured marketplace policies',
    description:
      'Returns delivery, return, warranty, and implied-warranty policy options for the connection. Cached for 10 minutes.',
  })
  @ApiResponse({ status: 200, description: 'Seller policies', type: SellerPoliciesResponseDto })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support seller-policy listing' })
  async getSellerPolicies(
    @Param('connectionId') connectionId: string
  ): Promise<SellerPoliciesResponseDto> {
    return this.sellerPolicies.getSellerPolicies(connectionId);
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('connections/:connectionId/responsible-producers')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiOperation({
    summary: 'List seller-configured responsible producers (#1531)',
    description:
      'Returns the EU GPSR responsible-producer registry ("producent") configured for the connection, fetched live from the marketplace. The offer-creation wizard renders these so the operator can attach one and the created product is not blocked for a missing producer.',
  })
  @ApiResponse({
    status: 200,
    description: 'Responsible producers wrapped under `responsibleProducers`.',
    type: ResponsibleProducersResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({
    status: 422,
    description: 'Adapter does not support responsible-producer listing',
  })
  async getResponsibleProducers(
    @Param('connectionId') connectionId: string
  ): Promise<ResponsibleProducersResponseDto> {
    const responsibleProducers =
      await this.responsibleProducers.listResponsibleProducers(connectionId);
    return { responsibleProducers };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('connections/:connectionId/delivery-price-lists')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiOperation({
    summary: 'List seller-configured delivery price lists (#1530)',
    description:
      'Returns the delivery price lists ("cennik dostawy") configured for the connection, fetched live from the marketplace. The offer-creation wizard renders these so the operator can attach one and the created offer is buyable.',
  })
  @ApiResponse({
    status: 200,
    description: 'Delivery price lists wrapped under `deliveryPriceLists`.',
    type: DeliveryPriceListsResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({
    status: 422,
    description: 'Adapter does not support delivery-price-list listing',
  })
  async getDeliveryPriceLists(
    @Param('connectionId') connectionId: string
  ): Promise<DeliveryPriceListsResponseDto> {
    const deliveryPriceLists = await this.deliveryPriceLists.listDeliveryPriceLists(connectionId);
    return { deliveryPriceLists };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('connections/:connectionId/categories/:categoryId/parameters')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiParam({ name: 'categoryId', description: 'Marketplace category ID (Allegro-issued).' })
  @ApiOperation({
    summary: 'List category parameters for offer creation (#410)',
    description:
      'Returns the full set of marketplace category parameters (required + optional) the create-offer wizard renders for the given connection. The adapter caches the upstream response for 24h by default; the FE additionally caches per (connectionId, categoryId) in TanStack Query.',
  })
  @ApiResponse({
    status: 200,
    description: 'Category parameters wrapped under `parameters`.',
    type: CategoryParametersListResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection or category not found.' })
  @ApiResponse({ status: 409, description: 'Connection disabled.' })
  @ApiResponse({
    status: 422,
    description: 'Adapter does not support category-parameters reading.',
  })
  async getCategoryParameters(
    @Param('connectionId') connectionId: string,
    @Param('categoryId') categoryId: string
  ): Promise<CategoryParametersListResponseDto> {
    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422) for upstream connection-level issues.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    if (!isCategoryParametersReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support category-parameters reading`
      );
    }

    let parameters: CategoryParameter[];
    try {
      parameters = await adapter.fetchCategoryParameters({ categoryId });
    } catch (err) {
      if (err instanceof CategoryNotFoundException) {
        // Bubble category-level 404 distinct from connection-level 404 — the FE
        // can show a friendlier message and let the operator pick a different
        // category without re-resolving the connection.
        throw new NotFoundException(
          `Category ${categoryId} not found on connection ${connectionId}`
        );
      }
      throw err;
    }

    return { parameters: parameters.map((p) => this.toCategoryParameterResponseDto(p)) };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('connections/:connectionId/categories/:categoryId/path')
  @HttpCode(HttpStatus.OK)
  // Category breadcrumbs are effectively immutable public taxonomy — let the
  // browser cache them for a day so re-opening the listing drawer never re-hits
  // the marketplace.
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiParam({ name: 'categoryId', description: 'Marketplace category ID (Allegro-issued).' })
  @ApiOperation({
    summary: 'Resolve a category id to its breadcrumb path (#1752)',
    description:
      "Returns the category's full ancestor breadcrumb ordered root -> leaf. The listing-detail drawer renders this instead of the raw category id Allegro's offer payload carries.",
  })
  @ApiResponse({
    status: 200,
    description: 'Breadcrumb segments wrapped under `path`.',
    type: CategoryPathResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection or category not found.' })
  @ApiResponse({ status: 409, description: 'Connection disabled.' })
  @ApiResponse({
    status: 422,
    description: 'Adapter does not support category-path reading.',
  })
  async getCategoryPath(
    @Param('connectionId') connectionId: string,
    @Param('categoryId') categoryId: string
  ): Promise<CategoryPathResponseDto> {
    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422) for upstream connection-level issues.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    if (!isCategoryPathReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support category-path reading`
      );
    }

    let path: CategoryPathSegment[];
    try {
      path = await adapter.fetchCategoryPath(categoryId);
    } catch (err) {
      if (err instanceof CategoryNotFoundException) {
        throw new NotFoundException(
          `Category ${categoryId} not found on connection ${connectionId}`
        );
      }
      throw err;
    }

    return { path: path.map((segment) => ({ id: segment.id, name: segment.name })) };
  }

  @Roles('admin', 'operator', 'viewer')
  @Post('connections/:connectionId/categories/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiOperation({
    summary: 'Resolve marketplace category (EAN auto-match + mapping fallback) (#631)',
    description:
      'Runs the 3-step category-resolution chain — auto-detect by barcode → configured ' +
      'source→marketplace mapping → manual — and returns the first hit. Mirrors the in-process ' +
      'flow already used by OfferCreationExecutionService. Returns method=manual with ' +
      'allegroCategoryId=null when nothing resolves (200, not 404 — manual is a normal outcome).',
  })
  @ApiResponse({ status: 200, description: 'Resolution result.', type: ResolveCategoryResponseDto })
  @ApiResponse({ status: 404, description: 'Connection not found.' })
  @ApiResponse({ status: 409, description: 'Connection disabled.' })
  @ApiResponse({
    status: 422,
    description: 'Connection does not support OfferManager.',
  })
  async resolveCategory(
    @Param('connectionId') connectionId: string,
    @Body() dto: ResolveCategoryRequestDto
  ): Promise<ResolveCategoryResponseDto> {
    // Validate the connection is a real, active marketplace before delegating.
    // The `OfferManager` capability is the "is this a marketplace connection"
    // gate — not a hard runtime requirement of the resolution algorithm. Step-2
    // (category mapping) doesn't actually need an adapter (`mappingConfig` is a
    // pure DB lookup); the pre-flight is here so unknown/disabled connections
    // surface as 404/409 instead of silently falling through to `method=manual`
    // inside the service. Matches the `categories/:categoryId/parameters` route.
    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422).
    await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    const result = await this.categoryResolution.resolveCategory({
      connectionId,
      barcode: dto.barcode ?? null,
      sourceCategoryIds: dto.sourceCategoryIds,
    });

    return {
      // Wire field stays `allegroCategoryId` (FE contract); neutralising it +
      // surfacing `provenance` is #1044's API/FE-surfaces job.
      allegroCategoryId: result.destinationCategoryId,
      method: result.method,
    };
  }

  @Roles('admin', 'operator', 'viewer')
  @Post('connections/:connectionId/categories/resolve-batch')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiOperation({
    summary: 'Batch-resolve marketplace categories by variant EAN, with mapping fallback (#795 / #1522)',
    description:
      'Resolves up to 200 variants to marketplace categories in one call. EAN catalogue ' +
      'match (via the connection adapter’s EanCategoryMatcher sub-capability, #735) is the ' +
      'primary path; when the EAN yields no match and the item supplies sourceCategoryIds, ' +
      'the batch falls back to the operator’s configured per-source-category mapping (#1522), ' +
      'returning method="category_mapping". Drives the bulk-listing wizard Resolve step, ' +
      'replacing the previous one-HTTP-call-per-row loop. Results are keyed by variantId; ' +
      'every input item gets exactly one entry.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-variant resolution results.',
    type: ResolveCategoryBatchResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection not found.' })
  @ApiResponse({ status: 409, description: 'Connection disabled.' })
  @ApiResponse({
    status: 422,
    description: 'Connection adapter does not support OfferManager / EanCategoryMatcher.',
  })
  async resolveCategoriesBatch(
    @Param('connectionId') connectionId: string,
    @Body() dto: ResolveCategoryBatchRequestDto
  ): Promise<ResolveCategoryBatchResponseDto> {
    try {
      const results = await this.categoryResolution.resolveCategoriesBatch(connectionId, {
        items: dto.items.map((item) => ({
          variantId: item.variantId,
          ean: item.ean ?? null,
          ...(item.sourceCategoryIds && item.sourceCategoryIds.length > 0
            ? { sourceCategoryIds: item.sourceCategoryIds }
            : {}),
        })),
      });
      return { results: Object.fromEntries(results) };
    } catch (error) {
      if (error instanceof AdapterCapabilityNotSupportedException) {
        // The connection isn't an OfferManager marketplace at all (the up-front
        // `getCapabilityAdapter('OfferManager')` gate). An adapter that simply
        // can't batch-match EANs no longer reaches here — the service degrades
        // it to per-variant `no-match` for manual category selection (ADR-025 §3).
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }

  // -----------------------------------------------------------------
  // Catalog product reader (#633).
  //
  // Two thin pass-through routes; no application service. The resolution
  // logic is "capability guard → delegate → return", which doesn't justify
  // a wrapper service of its own. Precedent: #631 has CategoryResolutionService
  // because that service runs a multi-source fallback algorithm; this PR's
  // routes have no such algorithm. If a second consumer of findProductsByBarcode
  // appears (e.g. a future bulk-prefill worker), promote to a service.
  // -----------------------------------------------------------------

  @Roles('admin', 'operator', 'viewer')
  @Post('connections/:connectionId/products/find-by-barcode')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiOperation({
    summary: 'Look up marketplace catalog products by barcode (#633)',
    description:
      'Returns a 3-state result: unique (full product eager-fetched), ambiguous ' +
      '(summaries only — call GET /products/:productId after the operator picks), or ' +
      'no_match (200, not 404 — normal outcome). Adapter caches upstream lookups for 24h.',
  })
  @ApiResponse({
    status: 200,
    description: 'Match result (discriminated by `kind`).',
    schema: findProductsByBarcodeResponseSchema,
  })
  @ApiResponse({ status: 404, description: 'Connection not found.' })
  @ApiResponse({ status: 409, description: 'Connection disabled.' })
  @ApiResponse({
    status: 422,
    description: 'Connection does not support OfferManager or CatalogProductReader.',
  })
  async findProductsByBarcode(
    @Param('connectionId') connectionId: string,
    @Body() dto: FindProductsByBarcodeRequestDto
  ): Promise<FindProductsByBarcodeResponseDto> {
    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422).
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    if (!isCatalogProductReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support catalog-product reading`
      );
    }

    const result = await adapter.findProductsByBarcode({
      barcode: dto.barcode,
      categoryId: dto.categoryId,
    });

    if (result.kind === 'unique') {
      return { kind: 'unique', product: this.toCatalogProductResponseDto(result.product) };
    }
    if (result.kind === 'ambiguous') {
      return { kind: 'ambiguous', products: result.products };
    }
    return { kind: 'no_match' };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('connections/:connectionId/products/:productId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiParam({ name: 'productId', description: 'Marketplace catalog product ID' })
  @ApiOperation({
    summary: 'Fetch a single marketplace catalog product by id (#633)',
    description:
      'Returns the full catalog product including parameters and images. ' +
      'Used by the wizard after an operator picks one of an ambiguous match.',
  })
  @ApiResponse({ status: 200, description: 'Catalog product.', type: CatalogProductResponseDto })
  @ApiResponse({ status: 404, description: 'Connection or product not found.' })
  @ApiResponse({ status: 409, description: 'Connection disabled.' })
  @ApiResponse({
    status: 422,
    description: 'Connection does not support OfferManager or CatalogProductReader.',
  })
  async getCatalogProduct(
    @Param('connectionId') connectionId: string,
    @Param('productId') productId: string
  ): Promise<CatalogProductResponseDto> {
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    if (!isCatalogProductReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support catalog-product reading`
      );
    }

    try {
      const product = await adapter.getProduct({ productId });
      return this.toCatalogProductResponseDto(product);
    } catch (err) {
      if (err instanceof CatalogProductNotFoundException) {
        throw new NotFoundException(
          `Catalog product ${productId} not found on connection ${connectionId}`
        );
      }
      throw err;
    }
  }

  private toCatalogProductResponseDto(p: CatalogProductResponseDto): CatalogProductResponseDto {
    // The neutral CatalogProduct is structurally identical to the response
    // DTO; this pass-through exists so any future field projection (e.g.
    // dropping `description` if it ever lands) has a single edit site.
    return {
      id: p.id,
      name: p.name,
      ean: p.ean,
      imageUrl: p.imageUrl,
      images: p.images,
      description: p.description,
      parameters: p.parameters,
    };
  }

  private toCategoryParameterResponseDto(p: CategoryParameter): CategoryParameterResponseDto {
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      required: p.required,
      unit: p.unit,
      dictionary: p.dictionary?.map((entry) => ({
        id: entry.id,
        value: entry.value,
        dependsOnValueIds: entry.dependsOnValueIds,
      })),
      restrictions: { ...p.restrictions },
      dependsOn: p.dependsOn ? { ...p.dependsOn } : undefined,
      section: p.section,
    };
  }

  private toDto(mapping: IdentifierMapping): OfferMappingResponseDto {
    return {
      id: mapping.id,
      entityType: mapping.entityType,
      internalId: mapping.internalId,
      externalId: mapping.externalId,
      platformType: mapping.platformType,
      connectionId: mapping.connectionId,
      context: mapping.context as Record<string, unknown> | null,
      createdAt:
        mapping.createdAt instanceof Date ? mapping.createdAt.toISOString() : mapping.createdAt,
      updatedAt:
        mapping.updatedAt instanceof Date ? mapping.updatedAt.toISOString() : mapping.updatedAt,
    };
  }

  private toOfferCreationStatusDto(record: OfferCreationRecord): OfferCreationStatusResponseDto {
    return {
      id: record.id,
      internalVariantId: record.internalVariantId,
      connectionId: record.connectionId,
      externalOfferId: record.externalOfferId,
      status: record.status,
      errors: record.errors,
      publishImmediately: record.publishImmediately,
      createdAt:
        record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
      updatedAt:
        record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
      // Pass the snapshot through untouched. It's already the on-wire shape
      // (plain object in jsonb); no date fields or instance conversions to run.
      request: record.request,
    };
  }
}
