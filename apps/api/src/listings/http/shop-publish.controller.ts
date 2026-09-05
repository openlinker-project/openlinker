/**
 * Shop Publish Controller (#1044)
 *
 * HTTP endpoints for single shop-product publish + per-record status polling.
 * Thin wrapper over `IProductPublishEnqueueService` (validate → enqueue → 202 +
 * ids) and `IListingCreationQueryService` (status read). The shop-side sibling
 * of the single-offer-create endpoint on `ListingsController`. Orchestration
 * lives in the core services per architecture-overview.md §7.
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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  IListingCreationQueryService,
  IProductPublishEnqueueService,
  IShopAttributeReadService,
  IShopCategoryBrowseService,
  LISTING_CREATION_QUERY_SERVICE_TOKEN,
  PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN,
  SHOP_ATTRIBUTE_READ_SERVICE_TOKEN,
  SHOP_CATEGORY_BROWSE_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type { ListingCreationRecord } from '@openlinker/core/listings';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AnyRole } from '../../auth/decorators/any-role.decorator';
import { PublishProductRequestDto } from './dto/publish-product.dto';
import {
  ListingCreationRecordResponseDto,
  ShopAttributeResponseDto,
  ShopAttributeTermResponseDto,
  ShopCategoryResponseDto,
  ShopPublishResponseDto,
} from './dto/shop-publish-response.dto';

@ApiBearerAuth()
@ApiTags('listings')
@Controller('listings/connections/:connectionId/shop-publish')
export class ShopPublishController {
  constructor(
    @Inject(PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN)
    private readonly enqueue: IProductPublishEnqueueService,
    @Inject(LISTING_CREATION_QUERY_SERVICE_TOKEN)
    private readonly query: IListingCreationQueryService,
    @Inject(SHOP_CATEGORY_BROWSE_SERVICE_TOKEN)
    private readonly categoryBrowse: IShopCategoryBrowseService,
    @Inject(SHOP_ATTRIBUTE_READ_SERVICE_TOKEN)
    private readonly attributeRead: IShopAttributeReadService,
  ) {}

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Publish a product to a shop connection',
    description:
      'Validates the connection ProductPublisher capability, pre-creates a listing-creation record, and enqueues a shop.product.publish job. Returns the jobId + record id to poll.',
  })
  @ApiResponse({ status: 202, description: 'Publish enqueued', type: ShopPublishResponseDto })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support ProductPublisher' })
  async publish(
    @Param('connectionId') connectionId: string,
    @Body() dto: PublishProductRequestDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ): Promise<ShopPublishResponseDto> {
    const { jobId, listingCreationRecord } = await this.enqueue.enqueuePublish({
      connectionId,
      internalVariantId: dto.internalVariantId,
      status: dto.status,
      stock: dto.stock,
      ...(dto.price !== undefined && { price: dto.price }),
      ...(dto.content !== undefined && { content: dto.content }),
      ...(dto.commerce !== undefined && { commerce: dto.commerce }),
      ...(dto.generateDescription !== undefined && {
        generateDescription: dto.generateDescription,
      }),
      ...(dto.descriptionTone !== undefined && { descriptionTone: dto.descriptionTone }),
      ...(idempotencyKey !== undefined && { idempotencyKey }),
    });
    return { jobId, listingCreationRecordId: listingCreationRecord.id };
  }

  @AnyRole()
  @Get('categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Browse a shop connection\'s existing category tree',
    description:
      "Returns the direct child categories under parentId (root level when omitted), read from OpenLinker's synced DestinationCategory projection rather than the live shop (#2085, ADR-037). The tree is refreshed by the destination.taxonomy.sync job, which is bootstrapped when a connection is created or enabled and re-run hourly — so a scope that has never synced returns an empty list rather than an error. Backs the publish edit flow category picker.",
  })
  @ApiQuery({
    name: 'parentId',
    required: false,
    description: 'Parent category id; omit for root-level categories.',
  })
  @ApiResponse({ status: 200, description: 'Category nodes', type: [ShopCategoryResponseDto] })
  // 404 / 409 were declared here until #2085 and are now unreachable: scope
  // resolution probes the destination kind through a swallowing try/catch, so
  // an unknown connection, a disabled one, and a missing browse capability all
  // arrive as the same 422. Declaring them would document a contract the route
  // cannot honour.
  @ApiResponse({
    status: 422,
    description:
      'No taxonomy source could be resolved for the connection — it does not exist, is disabled, or exposes no category browser (TaxonomySourceUnavailableException). The body shape also changed in #2085: `error` now carries the domain exception name rather than the generic "Unprocessable Entity".',
  })
  async browseCategories(
    @Param('connectionId') connectionId: string,
    @Query('parentId') parentId?: string,
  ): Promise<ShopCategoryResponseDto[]> {
    const categories = await this.categoryBrowse.browseCategories(connectionId, parentId);
    return categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
  }

  @AnyRole()
  @Get('attributes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Browse a shop connection's global product attributes",
    description:
      'Resolves the connection ProductPublisher adapter, narrows it to the ShopAttributeReader sub-capability, and returns the store-wide global attributes. Backs the publish edit flow structured attribute picker.',
  })
  @ApiResponse({ status: 200, description: 'Global attributes', type: [ShopAttributeResponseDto] })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support shop attribute reading' })
  async listAttributes(
    @Param('connectionId') connectionId: string,
  ): Promise<ShopAttributeResponseDto[]> {
    const attributes = await this.attributeRead.listAttributes(connectionId);
    return attributes.map((a) => ({ id: a.id, name: a.name, slug: a.slug }));
  }

  @AnyRole()
  @Get('attributes/:attributeId/terms')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'attributeId', description: 'Destination-native global-attribute id.' })
  @ApiOperation({
    summary: "Browse a global attribute's predefined terms",
    description:
      'Returns the predefined terms of one global attribute for the connection, via the ShopAttributeReader sub-capability. The term ids are threaded back on publish as the neutral valuesIds global-attribute linkage.',
  })
  @ApiResponse({ status: 200, description: 'Attribute terms', type: [ShopAttributeTermResponseDto] })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support shop attribute reading' })
  async listAttributeTerms(
    @Param('connectionId') connectionId: string,
    @Param('attributeId') attributeId: string,
  ): Promise<ShopAttributeTermResponseDto[]> {
    const terms = await this.attributeRead.listAttributeTerms(connectionId, attributeId);
    return terms.map((t) => ({ id: t.id, name: t.name, slug: t.slug }));
  }

  @AnyRole()
  @Get(':recordId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOperation({ summary: 'Get a shop publish record by id (status polling)' })
  @ApiResponse({
    status: 200,
    description: 'Publish record',
    type: ListingCreationRecordResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async getRecord(@Param('recordId') recordId: string): Promise<ListingCreationRecordResponseDto> {
    const record = await this.query.getById(recordId);
    if (!record) {
      throw new NotFoundException(`Listing creation record not found: ${recordId}`);
    }
    return this.toRecordDto(record);
  }

  private toRecordDto(record: ListingCreationRecord): ListingCreationRecordResponseDto {
    return {
      id: record.id,
      internalVariantId: record.internalVariantId,
      connectionId: record.connectionId,
      status: record.status,
      externalProductId: record.externalProductId,
      bulkBatchId: record.bulkBatchId,
      errors: record.errors,
      warnings: record.warnings,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
