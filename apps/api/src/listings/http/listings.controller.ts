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
import { ListOfferMappingsQueryDto } from './dto/list-offer-mappings-query.dto';
import { OfferMappingResponseDto } from './dto/offer-mapping-response.dto';
import { PaginatedOfferMappingsResponseDto } from './dto/paginated-offer-mappings-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappingRepository: OfferMappingRepositoryPort,
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
