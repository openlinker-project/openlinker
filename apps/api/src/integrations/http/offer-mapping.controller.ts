/**
 * Offer Mapping Controller
 *
 * HTTP REST API endpoints for offer mapping operations. Handles CRUD operations
 * for marketplace offer to product mappings.
 *
 * @module apps/api/src/integrations/http
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CreateOfferMappingDto } from './dto/create-offer-mapping.dto';
import { UpdateOfferMappingDto } from './dto/update-offer-mapping.dto';
import { OfferMappingResponseDto } from './dto/offer-mapping-response.dto';
import { IOfferMappingService, OFFER_MAPPING_SERVICE_TOKEN } from '@openlinker/core/listings';
import { Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

@ApiTags('offer-mappings')
@Controller('offer-mappings')
export class OfferMappingController {
  private readonly logger = new Logger(OfferMappingController.name);

  constructor(
    @Inject(OFFER_MAPPING_SERVICE_TOKEN)
    private readonly offerMappingService: IOfferMappingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new offer mapping' })
  @ApiResponse({
    status: 201,
    description: 'Offer mapping created successfully',
    type: OfferMappingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input or duplicate mapping' })
  async create(@Body() dto: CreateOfferMappingDto): Promise<OfferMappingResponseDto> {
    try {
      const mapping = await this.offerMappingService.create(
        dto.connectionId,
        dto.platformType,
        dto.offerId,
        dto.internalProductId,
        dto.variantId,
      );
      return OfferMappingResponseDto.fromDomain(mapping);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check for domain exception
      if (error instanceof Error && error.name === 'DuplicateOfferMappingError') {
        throw new BadRequestException(errorMessage);
      }
      if (errorMessage.includes('already exists')) {
        throw new BadRequestException(errorMessage);
      }
      this.logger.error(`Failed to create offer mapping: ${errorMessage}`, error);
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'List offer mappings with optional filters' })
  @ApiQuery({
    name: 'connectionId',
    required: false,
    description: 'Filter by connection ID',
  })
  @ApiQuery({
    name: 'productId',
    required: false,
    description: 'Filter by internal product ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of offer mappings',
    type: [OfferMappingResponseDto],
  })
  async list(
    @Query('connectionId') connectionId?: string,
    @Query('productId') productId?: string,
  ): Promise<OfferMappingResponseDto[]> {
    if (productId) {
      const mappings = await this.offerMappingService.findByProduct(productId);
      return mappings.map((mapping) => OfferMappingResponseDto.fromDomain(mapping));
    }

    if (connectionId) {
      const mappings = await this.offerMappingService.findByConnection(connectionId);
      return mappings.map((mapping) => OfferMappingResponseDto.fromDomain(mapping));
    }

    // For MVP, require at least one filter to prevent unbounded queries
    // TODO: Add pagination and full list support if needed
    throw new BadRequestException(
      'At least one filter (connectionId or productId) is required. Full list not supported in MVP.',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get offer mapping by ID' })
  @ApiParam({ name: 'id', description: 'Offer mapping ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Offer mapping details',
    type: OfferMappingResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Offer mapping not found' })
  async get(@Param('id') id: string): Promise<OfferMappingResponseDto> {
    const mapping = await this.offerMappingService.findById(id);
    if (!mapping) {
      throw new NotFoundException(`Offer mapping not found: ${id}`);
    }
    return OfferMappingResponseDto.fromDomain(mapping);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing offer mapping' })
  @ApiParam({ name: 'id', description: 'Offer mapping ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Offer mapping updated successfully',
    type: OfferMappingResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Offer mapping not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOfferMappingDto,
  ): Promise<OfferMappingResponseDto> {
    try {
      const mapping = await this.offerMappingService.update(id, {
        internalProductId: dto.internalProductId,
        variantId: dto.variantId,
      });
      return OfferMappingResponseDto.fromDomain(mapping);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not found')) {
        throw new NotFoundException(errorMessage);
      }
      this.logger.error(`Failed to update offer mapping: ${errorMessage}`, error);
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an offer mapping' })
  @ApiParam({ name: 'id', description: 'Offer mapping ID (UUID)' })
  @ApiResponse({
    status: 204,
    description: 'Offer mapping deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Offer mapping not found' })
  async delete(@Param('id') id: string): Promise<void> {
    try {
      await this.offerMappingService.delete(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not found')) {
        throw new NotFoundException(errorMessage);
      }
      this.logger.error(`Failed to delete offer mapping: ${errorMessage}`, error);
      throw error;
    }
  }
}

