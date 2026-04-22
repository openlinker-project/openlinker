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
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';

import { Roles } from '../../auth/decorators/roles.decorator';
import {
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  SELLER_POLICIES_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type {
  IOfferCreationEnqueueService,
  ISellerPoliciesService,
  OfferCreationRecord,
  OfferCreationRecordRepositoryPort,
  OfferMappingRepositoryPort,
} from '@openlinker/core/listings';
import type { EntityType, IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import type { JobEnqueuePort } from '@openlinker/core/sync';

import { ListOfferMappingsQueryDto } from './dto/list-offer-mappings-query.dto';
import { OfferMappingResponseDto } from './dto/offer-mapping-response.dto';
import { PaginatedOfferMappingsResponseDto } from './dto/paginated-offer-mappings-response.dto';
import { UpdateOfferFieldsDto, UpdateOfferFieldsResponseDto } from './dto/update-offer-fields.dto';
import { AutoMatchVariantsRequestDto, AutoMatchVariantsResponseDto } from './dto/auto-match-variants.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CreateOfferResponseDto } from './dto/create-offer-response.dto';
import { OfferCreationStatusResponseDto } from './dto/offer-creation-status-response.dto';
import { SellerPoliciesResponseDto } from './dto/seller-policies-response.dto';

@Roles('admin')
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
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List offer mappings',
    description:
      'Returns a paginated list of offer-to-variant mappings. Supports filtering by connectionId, platformType, internalId, and search on externalId.',
  })
  @ApiResponse({ status: 200, description: 'Paginated offer mappings list', type: PaginatedOfferMappingsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listOfferMappings(
    @Query() query: ListOfferMappingsQueryDto,
  ): Promise<PaginatedOfferMappingsResponseDto> {
    const { connectionId, platformType, internalId, search, limit = 20, offset = 0 } = query;

    const { items, total } = await this.offerMappingRepository.findMany(
      { connectionId, platformType, internalId, search },
      { limit, offset },
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
  async getOfferMapping(@Param('id') id: string): Promise<OfferMappingResponseDto> {
    const mapping = await this.offerMappingRepository.findById(id);
    if (!mapping) {
      throw new NotFoundException(`Offer mapping not found: ${id}`);
    }

    const dto = this.toDto(mapping);
    // Enrich Offer-type mappings with the matching OfferCreationRecord so the
    // detail page can show creation status + errors for OL-initiated offers
    // without a second round-trip. Synced-in offers (no matching record) and
    // non-Offer entity types fall through to a plain DTO.
    if (mapping.entityType === ('Offer' satisfies EntityType)) {
      const record = await this.offerCreationRecords.findByExternalOfferIdAndConnectionId(
        mapping.externalId,
        mapping.connectionId,
      );
      if (record) {
        dto.offerCreation = this.toOfferCreationStatusDto(record);
      }
    }
    return dto;
  }

  @Post('connections/:connectionId/offers/:offerId/fields')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'connectionId', description: 'Connection ID' })
  @ApiParam({ name: 'offerId', description: 'Internal OpenLinker offer ID' })
  @ApiOperation({
    summary: 'Update offer fields',
    description:
      'Dispatches an async job to update Allegro offer fields (price, title, description). At least one field must be provided. Returns 202 Accepted with a job ID.',
  })
  @ApiResponse({ status: 202, description: 'Update job dispatched', type: UpdateOfferFieldsResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — no fields provided or invalid values' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async updateOfferFields(
    @Param('connectionId') connectionId: string,
    @Param('offerId') offerId: string,
    @Body() dto: UpdateOfferFieldsDto,
    @Headers('x-idempotency-key') clientIdempotencyKey?: string,
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

  @Post('connections/:connectionId/sync/auto-match-variants')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID (e.g., Allegro)' })
  @ApiOperation({
    summary: 'Auto-match variants to offers',
    description:
      'Dispatches a background job that matches PrestaShop product variants to marketplace offers by EAN/SKU. Returns 202 Accepted with a job ID.',
  })
  @ApiResponse({ status: 202, description: 'Auto-match job dispatched', type: AutoMatchVariantsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async autoMatchVariants(
    @Param('connectionId') connectionId: string,
    @Body() dto: AutoMatchVariantsRequestDto,
    @Headers('x-idempotency-key') clientIdempotencyKey?: string,
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

  @Post('connections/:connectionId/offers')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
  @ApiOperation({
    summary: 'Create a marketplace offer from an OpenLinker variant',
    description:
      'Validates the connection and adapter capability, pre-creates an OfferCreationRecord (status=pending), and enqueues a marketplace.offer.create job. Poll GET /listings/connections/:connectionId/offers/creation/:offerCreationRecordId for lifecycle updates.',
  })
  @ApiResponse({ status: 202, description: 'Creation job dispatched', type: CreateOfferResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support offer creation' })
  async createOffer(
    @Param('connectionId') connectionId: string,
    @Body() dto: CreateOfferDto,
    @Headers('x-idempotency-key') clientIdempotencyKey?: string,
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
  @ApiParam({ name: 'offerCreationRecordId', description: 'OfferCreationRecord id returned by POST /offers' })
  @ApiOperation({ summary: 'Get offer-creation record status' })
  @ApiResponse({ status: 200, description: 'Record detail', type: OfferCreationStatusResponseDto })
  @ApiResponse({ status: 404, description: 'Record not found or belongs to a different connection' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getOfferCreationStatus(
    @Param('connectionId') connectionId: string,
    @Param('offerCreationRecordId') offerCreationRecordId: string,
  ): Promise<OfferCreationStatusResponseDto> {
    const record = await this.offerCreationRecords.findById(offerCreationRecordId);
    if (!record || record.connectionId !== connectionId) {
      // Cross-connection lookups return 404 to avoid leaking record existence.
      throw new NotFoundException(`Offer creation record not found: ${offerCreationRecordId}`);
    }
    return this.toOfferCreationStatusDto(record);
  }

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
    @Param('connectionId') connectionId: string,
  ): Promise<SellerPoliciesResponseDto> {
    return this.sellerPolicies.getSellerPolicies(connectionId);
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
      createdAt: mapping.createdAt instanceof Date ? mapping.createdAt.toISOString() : mapping.createdAt,
      updatedAt: mapping.updatedAt instanceof Date ? mapping.updatedAt.toISOString() : mapping.updatedAt,
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
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
      updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
      // Pass the snapshot through untouched. It's already the on-wire shape
      // (plain object in jsonb); no date fields or instance conversions to run.
      request: record.request,
    };
  }
}
