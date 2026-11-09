/**
 * Listing Sale Status Controller (#3962)
 *
 * The product page's "Sales channels" section: where a product deleted at
 * the master is still on sale, what OpenLinker did on each channel, how many
 * orders arrived since, and the operator's "put back on sale". Plus the count
 * the products list banner shows.
 *
 * Registered BEFORE `ListingsController` in the module: Nest matches routes
 * in registration order, and that controller's `GET :id` would otherwise
 * swallow `GET /listings/sale-holds/attention-count`.
 *
 * @module apps/api/src/listings/http
 */
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  LISTING_SALE_STATUS_SERVICE_TOKEN,
  SaleHoldReleaseRefusedException,
  type IListingSaleStatusService,
  type ListingSaleRow,
} from '@openlinker/core/listings';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';

import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type {
  ListingSaleRowDto} from './dto/listing-sale-status.dto';
import {
  ProductSaleStatusResponseDto,
  ReleaseSaleHoldsRequestDto,
  ReleaseSaleHoldsResponseDto,
  SaleHoldAttentionCountResponseDto,
} from './dto/listing-sale-status.dto';

@ApiTags('listings')
@ApiBearerAuth()
@Controller('listings')
export class ListingSaleStatusController {
  constructor(
    @Inject(LISTING_SALE_STATUS_SERVICE_TOKEN)
    private readonly saleStatus: IListingSaleStatusService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('sale-holds/attention-count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Products deleted at the source that a channel still sells' })
  @ApiResponse({ status: 200, type: SaleHoldAttentionCountResponseDto })
  async attentionCount(): Promise<SaleHoldAttentionCountResponseDto> {
    return { productsStillOnSale: await this.saleStatus.countProductsStillOnSale() };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('products/:productId/sale-status')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'productId', description: 'Internal OL product id' })
  @ApiOperation({
    summary: 'Where a product is on sale, per channel',
    description:
      'One row per listing (marketplace offer or shop product) with the channel status, quantity and last check OpenLinker holds, and what it did when the product was deleted at the source. No channel is called.',
  })
  @ApiResponse({ status: 200, type: ProductSaleStatusResponseDto })
  async getSaleStatus(@Param('productId') productId: string): Promise<ProductSaleStatusResponseDto> {
    const status = await this.saleStatus.getProductSaleStatus(productId);
    const variants = status.staleVariantIds.length > 0 ? await this.products.getVariantsByProductId(productId) : [];
    const staleSkus = variants
      .filter((v) => status.staleVariantIds.includes(v.id) && v.sku)
      .map((v) => v.sku as string);
    // Null when it cannot be counted (nothing deleted, or no SKU to match) -
    // never a 0 that reads as "no orders".
    const ordersSinceDeletion =
      status.deletedAt && staleSkus.length > 0
        ? await this.orderRecords.countOrdersForSkusSince(staleSkus, status.deletedAt)
        : null;
    return {
      productId: status.productId,
      deletedAtSource: status.deletedAtSource,
      deletedAt: status.deletedAt?.toISOString() ?? null,
      staleVariantIds: status.staleVariantIds,
      staleSkus,
      ordersSinceDeletion,
      checkedAt: status.checkedAt?.toISOString() ?? null,
      rows: status.rows.map((row) => this.toRowDto(row)),
    };
  }

  @Roles('admin', 'operator')
  @Post('products/:productId/sale-holds/release')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'productId', description: 'Internal OL product id' })
  @ApiOperation({
    summary: 'Put held listings back on sale',
    description:
      'Shows hidden shop products again and lets stock flow to the selected listings. Refused with 409 while the product is still deleted at the source.',
  })
  @ApiResponse({ status: 200, type: ReleaseSaleHoldsResponseDto })
  @ApiResponse({ status: 409, description: 'The product is still deleted at the source' })
  async release(
    @Param('productId') productId: string,
    @Body() dto: ReleaseSaleHoldsRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReleaseSaleHoldsResponseDto> {
    try {
      return await this.saleStatus.releaseHolds(productId, dto.holdIds, user.id);
    } catch (error) {
      if (error instanceof SaleHoldReleaseRefusedException) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  private toRowDto(row: ListingSaleRow): ListingSaleRowDto {
    return {
      connectionId: row.connectionId,
      entityType: row.entityType,
      externalId: row.externalId,
      externalParentId: row.externalParentId,
      internalVariantId: row.internalVariantId,
      channelStatus: row.channelStatus,
      quantity: row.quantity,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      hold: row.hold
        ? {
            id: row.hold.id,
            method: row.hold.method,
            outcome: row.hold.outcome,
            outcomeReason: row.hold.outcomeReason,
            appliedAt: row.hold.appliedAt.toISOString(),
          }
        : null,
      state: row.state,
    };
  }
}
