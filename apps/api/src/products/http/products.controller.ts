/**
 * Products Controller
 *
 * HTTP REST API endpoints for product and variant read operations. Provides
 * paginated listing, detail views with external ID enrichment, and variant
 * search capabilities.
 *
 * Routes are split across two controllers because product routes live under
 * /products while variant search lives under /variants.
 *
 * @module apps/api/src/products/http
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
import { PRODUCTS_SERVICE_TOKEN, ProductEntity, ProductVariant } from '@openlinker/core/products';
import { IDENTIFIER_MAPPING_SERVICE_TOKEN } from '@openlinker/core/identifier-mapping';
import type { IProductsService } from '@openlinker/core/products';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ListProductVariantsQueryDto } from './dto/list-product-variants-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductVariantResponseDto } from './dto/product-variant-response.dto';
import { PaginatedProductsResponseDto } from './dto/paginated-products-response.dto';
import { PaginatedProductVariantsResponseDto } from './dto/paginated-product-variants-response.dto';
import { ExternalIdMappingDto } from './dto/external-id-mapping.dto';

const MAX_VARIANTS_IN_DETAIL = 100;

/**
 * Shared variant-to-DTO mapper.
 *
 * Timestamps are optional on the ProductVariant interface because adapters
 * produce pre-persistence variants. In these controllers the variant is always
 * repository-sourced (see ProductVariantRepository#toDomain), so timestamps are
 * guaranteed present — non-null assertion crashes loudly if the invariant ever
 * breaks, which is preferable to silently emitting a 1970 epoch date.
 */
function variantToDto(variant: ProductVariant): ProductVariantResponseDto {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    attributes: variant.attributes,
    ean: variant.ean ?? null,
    gtin: variant.gtin ?? null,
    createdAt: variant.createdAt!.toISOString(),
    updatedAt: variant.updatedAt!.toISOString(),
  };
}

@Roles('admin')
@ApiBearerAuth()
@ApiTags('products')
@Controller('products')
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IdentifierMappingPort,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List products',
    description: 'Returns a paginated list of products. Supports search by name or SKU.',
  })
  @ApiResponse({ status: 200, description: 'Paginated product list', type: PaginatedProductsResponseDto })
  async listProducts(@Query() query: ListProductsQueryDto): Promise<PaginatedProductsResponseDto> {
    const { search, limit = 20, offset = 0 } = query;

    const { items, total } = await this.productsService.listProducts(
      { search },
      { limit, offset },
    );

    return {
      items: items.map((p) => this.toProductDto(p)),
      total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get product detail',
    description: 'Returns a single product with its variants and external identifier mappings.',
  })
  @ApiParam({ name: 'id', description: 'Internal product ID (e.g. ol_product_...)' })
  @ApiResponse({ status: 200, description: 'Product detail', type: ProductResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async getProduct(@Param('id') id: string): Promise<ProductResponseDto> {
    const product = await this.productsService.getProduct(id);
    if (!product) {
      throw new NotFoundException(`Product not found: ${id}`);
    }

    // Load variants
    const { items: variants, total: variantCount } = await this.productsService.listVariants(
      { productId: id },
      { limit: MAX_VARIANTS_IN_DETAIL, offset: 0 },
    );

    if (variantCount > MAX_VARIANTS_IN_DETAIL) {
      this.logger.warn(
        `Product ${id} has ${variantCount} variants but detail response is capped at ${MAX_VARIANTS_IN_DETAIL}`,
      );
    }

    // Load external IDs for product and all variants in parallel
    const [productExternalIds, ...variantExternalIdResults] = await Promise.all([
      this.identifierMapping.getExternalIds('Product', id),
      ...variants.map((v) => this.identifierMapping.getExternalIds('Product', v.id)),
    ]);

    const variantDtos = variants.map((v, i) => {
      const dto = this.toVariantDto(v);
      dto.externalIds = variantExternalIdResults[i].map((e) => this.toExternalIdDto(e));
      return dto;
    });

    const dto = this.toProductDto(product);
    dto.variants = variantDtos;
    dto.externalIds = productExternalIds.map((e) => this.toExternalIdDto(e));
    return dto;
  }

  @Get(':productId/variants')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List variants for a product',
    description: 'Returns a paginated list of variants belonging to a specific product.',
  })
  @ApiParam({ name: 'productId', description: 'Internal product ID (e.g. ol_product_...)' })
  @ApiResponse({ status: 200, description: 'Paginated variant list', type: PaginatedProductVariantsResponseDto })
  async listVariantsByProduct(
    @Param('productId') productId: string,
    @Query() query: ListProductVariantsQueryDto,
  ): Promise<PaginatedProductVariantsResponseDto> {
    const { search, limit = 20, offset = 0 } = query;

    const { items, total } = await this.productsService.listVariants(
      { productId, search },
      { limit, offset },
    );

    return {
      items: items.map((v) => this.toVariantDto(v)),
      total,
      limit,
      offset,
    };
  }

  private toProductDto(product: ProductEntity): ProductResponseDto {
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      description: product.description,
      images: product.images,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  private toVariantDto(variant: ProductVariant): ProductVariantResponseDto {
    return variantToDto(variant);
  }

  private toExternalIdDto(mapping: { externalId: string; platformType: string; connectionId: string }): ExternalIdMappingDto {
    return {
      externalId: mapping.externalId,
      platformType: mapping.platformType,
      connectionId: mapping.connectionId,
    };
  }
}

/**
 * Variants Controller
 *
 * Separate controller for variant-level routes that don't live under /products.
 *
 * @module apps/api/src/products/http
 */
@Roles('admin')
@ApiBearerAuth()
@ApiTags('variants')
@Controller('variants')
export class VariantsController {
  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
  ) {}

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search variants',
    description: 'Search variants across all products by SKU, EAN, or GTIN.',
  })
  @ApiResponse({ status: 200, description: 'Paginated variant search results', type: PaginatedProductVariantsResponseDto })
  async searchVariants(@Query() query: ListProductVariantsQueryDto): Promise<PaginatedProductVariantsResponseDto> {
    const { search, limit = 20, offset = 0 } = query;

    const { items, total } = await this.productsService.listVariants(
      { search },
      { limit, offset },
    );

    return {
      items: items.map((v) => this.toVariantDto(v)),
      total,
      limit,
      offset,
    };
  }

  private toVariantDto(variant: ProductVariant): ProductVariantResponseDto {
    return variantToDto(variant);
  }
}
