/**
 * Listings Controller
 *
 * HTTP REST API endpoints for offer mapping read operations. Provides endpoints
 * for listing offer-to-variant mappings with filters and retrieving individual
 * offer mapping details.
 *
 * @module apps/api/src/listings/http
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { OFFER_MAPPING_REPOSITORY_TOKEN } from '@openlinker/core/listings';
import type { OfferMappingRepositoryPort } from '@openlinker/core/listings';
import type { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { randomUUID } from 'crypto';
import { ListOfferMappingsQueryDto } from './dto/list-offer-mappings-query.dto';
import { OfferMappingResponseDto } from './dto/offer-mapping-response.dto';
import { PaginatedOfferMappingsResponseDto } from './dto/paginated-offer-mappings-response.dto';
import { UpdateOfferFieldsDto, UpdateOfferFieldsResponseDto } from './dto/update-offer-fields.dto';

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
    return this.toDto(mapping);
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
}
