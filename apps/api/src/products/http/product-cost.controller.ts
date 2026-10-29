/**
 * Product Cost Controller (#3588, epic #3516, D27)
 *
 * Operator-authored net unit cost on variants. Lives under `/products` and is
 * registered BEFORE `ProductsController` in the module: `PATCH
 * variants/cost` and `GET :productId/variant-costs` must not be swallowed by
 * the `variants/:variantId` / `:id` routes declared there. Writes are
 * admin-only (G11-B); the read feeds the product page column and is open to
 * operator/viewer. A packer reaches none of it.
 *
 * @module apps/api/src/products/http
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  IProductsService,
  InvalidVariantCostError,
  PRODUCTS_SERVICE_TOKEN,
  ProductVariantNotFoundError,
} from '@openlinker/core/products';
import type { ProductVariant } from '@openlinker/core/products';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
// Value import: the @CurrentUser() param type feeds decorator metadata.
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  BulkFillVariantCostRequestDto,
  BulkFillVariantCostResponseDto,
  ProductVariantCostResponseDto,
  SetVariantCostRequestDto,
  VariantCostResponseDto,
} from './dto/variant-cost.dto';

@ApiBearerAuth()
@ApiTags('products')
@Controller('products')
export class ProductCostController {
  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService
  ) {}

  // Declared before the `:variantId` route so the literal `cost` segment of the
  // bulk route is never read as a variant id.
  @Roles('admin')
  @Patch('variants/cost')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fill one net unit cost across many variants',
    description:
      'Sets the cost only on variants that have none; never overwrites. Reports which ids were filled, already had a cost, or do not exist.',
  })
  @ApiResponse({ status: 200, type: BulkFillVariantCostResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid ids, amount or currency' })
  async bulkFillCost(
    @Body() dto: BulkFillVariantCostRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BulkFillVariantCostResponseDto> {
    try {
      const result = await this.productsService.fillVariantCostsIfAbsent(
        dto.variantIds,
        dto.netUnitCost,
        dto.currency,
        user.id
      );
      return {
        filled: result.filled,
        skippedAlreadySet: result.skippedAlreadySet,
        notFound: result.notFound,
      };
    } catch (error) {
      throw this.mapDomainError(error);
    }
  }

  @Roles('admin')
  @Patch('variants/:variantId/cost')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set or clear one variant net unit cost',
    description: 'Both fields set records the cost; both null clears it. 0.00 is a valid cost.',
  })
  @ApiResponse({ status: 200, type: VariantCostResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid amount/currency or half a pair' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  async setVariantCost(
    @Param('variantId') variantId: string,
    @Body() dto: SetVariantCostRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<VariantCostResponseDto> {
    try {
      await this.productsService.recordVariantCost(
        variantId,
        dto.netUnitCost !== null && dto.currency !== null
          ? { netUnitCost: dto.netUnitCost, currency: dto.currency }
          : null,
        user.id
      );
    } catch (error) {
      throw this.mapDomainError(error);
    }
    const variant = await this.productsService.getVariant(variantId);
    if (!variant) {
      throw new NotFoundException(`Product variant not found: ${variantId}`);
    }
    return this.toCostResponse(variant);
  }

  @Roles('admin', 'operator', 'viewer')
  @Get(':productId/variant-costs')
  @ApiOperation({ summary: 'List the net unit cost of every variant of a product' })
  @ApiResponse({ status: 200, type: [ProductVariantCostResponseDto] })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async listVariantCosts(
    @Param('productId') productId: string
  ): Promise<ProductVariantCostResponseDto[]> {
    const product = await this.productsService.getProduct(productId);
    if (!product) {
      throw new NotFoundException(`Product not found: ${productId}`);
    }
    const variants = await this.productsService.getVariantsByProductId(productId);
    return variants.map((v) => ({ ...this.toCostResponse(v), sku: v.sku }));
  }

  private mapDomainError(error: unknown): Error {
    if (error instanceof ProductVariantNotFoundError) {
      return new NotFoundException(error.message);
    }
    if (error instanceof InvalidVariantCostError) {
      return new BadRequestException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private toCostResponse(variant: ProductVariant): VariantCostResponseDto {
    return {
      variantId: variant.id,
      netUnitCost: variant.netUnitCost ?? null,
      costCurrency: variant.costCurrency ?? null,
      costUpdatedAt: variant.costUpdatedAt ? variant.costUpdatedAt.toISOString() : null,
      costUpdatedByUserId: variant.costUpdatedByUserId ?? null,
    };
  }
}
