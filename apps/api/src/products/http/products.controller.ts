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
  BadRequestException,
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import {
  PRODUCTS_SERVICE_TOKEN,
  IProductsService,
  TAX_RATE_JOURNAL_SERVICE_TOKEN,
  ITaxRateJournalService,
} from '@openlinker/core/products';
import { IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type {
  Product,
  ProductVariant,
  ProductListSort,
  TaxRateJournalEntry,
} from '@openlinker/core/products';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { IInventoryQueryService, INVENTORY_QUERY_SERVICE_TOKEN } from '@openlinker/core/inventory';
import {
  IOfferMappingsService,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  IShopProductMappingsService,
  SHOP_PRODUCT_MAPPINGS_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type { ProductListingsCoverage } from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ListProductVariantsQueryDto } from './dto/list-product-variants-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import type { ProductVariantResponseDto } from './dto/product-variant-response.dto';
import { ProductVariantSummaryResponseDto } from './dto/product-variant-summary-response.dto';
import { PaginatedProductsResponseDto } from './dto/paginated-products-response.dto';
import { PaginatedProductVariantsResponseDto } from './dto/paginated-product-variants-response.dto';
import type { ExternalIdMappingDto } from './dto/external-id-mapping.dto';
import type { ProductListingsCoverageDto } from './dto/product-listings-coverage.dto';
import type { TaxRateJournalEntryResponseDto } from './dto/tax-rate-journal-entry-response.dto';
import { TaxRateJournalResponseDto } from './dto/tax-rate-journal-entry-response.dto';

const MAX_VARIANTS_IN_DETAIL = 100;

// Cap on the number of connection ids accepted through the `unlistedOn` CSV
// (#1720) - the realistic marketplace-connection count is single digits.
const MAX_UNLISTED_ON_CONNECTION_IDS = 20;

// Connection ids are UUIDs (connections.id). Validating the shape here keeps
// garbage input out of the repository's `::uuid[]` cast (a non-UUID string
// would otherwise surface as a Postgres 22P02 error / HTTP 500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // Optional on the domain entity (adapters may omit on construction);
    // normalised to `null` at the wire boundary so the FE sees a consistent
    // nullable shape.
    price: variant.price ?? null,
    // #2255 — the variant's own OVERRIDE, and only that. An absent override
    // means the product's rate applies, which the table renders as "inherited"
    // rather than as a gap; conflating the two would send the operator to fix
    // the wrong record.
    taxRate: variant.taxRate ?? null,
    taxRateCountry: variant.taxRateCountry ?? null,
    taxRateReadAt: variant.taxRateReadAt?.toISOString() ?? null,
    createdAt: variant.createdAt!.toISOString(),
    updatedAt: variant.updatedAt!.toISOString(),
  };
}

/**
 * Shared journal-entry-to-DTO mapper (#2250).
 *
 * `frozen` is optional on the observation type (a `shop` reading has no such
 * concept) and is normalised to `false` at the wire boundary, matching what the
 * column stores.
 */
function toTaxRateJournalEntryDto(entry: TaxRateJournalEntry): TaxRateJournalEntryResponseDto {
  return {
    id: entry.id,
    productId: entry.productId,
    variantId: entry.variantId,
    connectionId: entry.connectionId,
    origin: entry.origin,
    taxRate: entry.taxRate,
    frozen: entry.frozen ?? false,
    observedAt: entry.observedAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
  };
}

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
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService,
    @Inject(OFFER_MAPPINGS_SERVICE_TOKEN)
    private readonly offerMappings: IOfferMappingsService,
    @Inject(SHOP_PRODUCT_MAPPINGS_SERVICE_TOKEN)
    private readonly shopProductMappings: IShopProductMappingsService,
    // #2250 - the provenance read. A plain query through the context's own
    // service interface; no new service and no new context for a read.
    @Inject(TAX_RATE_JOURNAL_SERVICE_TOKEN)
    private readonly taxRateJournal: ITaxRateJournalService
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List products',
    description: 'Returns a paginated list of products. Supports search by name or SKU.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated product list',
    type: PaginatedProductsResponseDto,
  })
  async listProducts(@Query() query: ListProductsQueryDto): Promise<PaginatedProductsResponseDto> {
    const { search, stock, taxRateState, connectionId, sort, dir, limit = 20, offset = 0 } = query;

    const unlistedOnConnectionIds = this.parseUnlistedOn(query.unlistedOn);
    const sortSpec: ProductListSort | undefined = sort
      ? { field: sort, dir: dir ?? 'desc' }
      : undefined;

    const { items, total } = await this.productsService.listProducts(
      { search, stock, taxRateState, unlistedOnConnectionIds, sourceConnectionId: connectionId },
      { limit, offset },
      sortSpec
    );

    const dtos = items.map((p) => this.toProductDto(p));

    // Display enrichment (#1720): page-scoped cross-context reads composed
    // at the interface layer - stock aggregates (inventory), listings
    // coverage (listings), variant counts (products), and source external
    // ids (identifier mapping), all in parallel.
    if (items.length > 0) {
      const ids = items.map((p) => p.id);
      const [aggregates, offerCoverage, shopCoverage, variantCounts, externalIdLists] =
        await Promise.all([
          this.inventoryQuery.getProductStockAggregates(ids),
          this.offerMappings.countListedVariantsByProducts(ids),
          // Shop-destination coverage (#1838 follow-up fix): a product published
          // to a WooCommerce connection previously showed no coverage indication
          // because only Offer mappings fed this pipeline.
          this.shopProductMappings.countListedVariantsByProducts(ids),
          this.productsService.getVariantCountsByProductIds(ids),
          Promise.all(ids.map((id) => this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, id))),
        ]);

      const aggregateByProduct = new Map(aggregates.map((a) => [a.productId, a]));
      const coverageByProduct = new Map<string, ProductListingsCoverageDto[]>();
      for (const row of [...offerCoverage, ...shopCoverage]) {
        const list = coverageByProduct.get(row.productId) ?? [];
        list.push(this.toCoverageDto(row));
        coverageByProduct.set(row.productId, list);
      }

      dtos.forEach((dto, i) => {
        const aggregate = aggregateByProduct.get(dto.id);
        // Products with no inventory rows have no aggregate row - zero-fill
        // for display (no stock = 0 available / 0 reserved, never written).
        dto.totalAvailable = aggregate?.totalAvailable ?? 0;
        dto.totalReserved = aggregate?.totalReserved ?? 0;
        dto.stockUpdatedAt = aggregate?.stockUpdatedAt ? aggregate.stockUpdatedAt.toISOString() : null;
        dto.variantCount = variantCounts.get(dto.id) ?? 0;
        dto.listingsCoverage = coverageByProduct.get(dto.id) ?? [];
        dto.externalIds = externalIdLists[i].map((e) => this.toExternalIdDto(e));
      });
    }

    return {
      items: dtos,
      total,
      limit,
      offset,
    };
  }

  /**
   * Split, trim, dedupe, and cap the `unlistedOn` CSV (#1720). Rejects
   * non-UUID entries with 400 so garbage never reaches the repository's
   * `::uuid[]` cast (which would surface as an HTTP 500).
   */
  private parseUnlistedOn(csv: string | undefined): readonly string[] | undefined {
    if (!csv) return undefined;
    const ids = [
      ...new Set(
        csv
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      ),
    ];
    if (ids.length === 0) return undefined;
    const invalid = ids.filter((id) => !UUID_RE.test(id));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `unlistedOn must be a CSV of connection UUIDs; invalid entries: ${invalid.join(', ')}`
      );
    }
    return ids.slice(0, MAX_UNLISTED_ON_CONNECTION_IDS);
  }

  private toCoverageDto(row: ProductListingsCoverage): ProductListingsCoverageDto {
    return {
      connectionId: row.connectionId,
      platformType: row.platformType,
      listedVariants: row.listedVariants,
    };
  }

  // Declared before @Get(':id') so /products/variants/:variantId is matched
  // by this handler rather than getProduct (which would treat 'variants' as
  // an invalid product ID). Nest's pattern matcher follows registration order,
  // so route ordering matters here.
  @Get('variants/:variantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get variant summary by internal variant ID',
    description:
      'Lightweight projection of a product variant — id, parent product id, SKU, EAN, optional name. Used by the listing-detail page (#464) to surface the linked variant inline next to the Internal ID row without forcing the FE to know the parent product first.',
  })
  @ApiParam({ name: 'variantId', description: 'Internal variant ID (e.g. ol_variant_...)' })
  @ApiResponse({
    status: 200,
    description: 'Variant summary',
    type: ProductVariantSummaryResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  async getVariantSummary(
    @Param('variantId') variantId: string
  ): Promise<ProductVariantSummaryResponseDto> {
    const variant = await this.productsService.getVariant(variantId);
    if (!variant) {
      throw new NotFoundException(`Variant not found: ${variantId}`);
    }
    return this.toVariantSummaryDto(variant);
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
      { limit: MAX_VARIANTS_IN_DETAIL, offset: 0 }
    );

    if (variantCount > MAX_VARIANTS_IN_DETAIL) {
      this.logger.warn(
        `Product ${id} has ${variantCount} variants but detail response is capped at ${MAX_VARIANTS_IN_DETAIL}`
      );
    }

    // Load external IDs for product and all variants in parallel
    const [productExternalIds, ...variantExternalIdResults] = await Promise.all([
      this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, id),
      ...variants.map((v) => this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, v.id)),
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
  @ApiResponse({
    status: 200,
    description: 'Paginated variant list',
    type: PaginatedProductVariantsResponseDto,
  })
  async listVariantsByProduct(
    @Param('productId') productId: string,
    @Query() query: ListProductVariantsQueryDto
  ): Promise<PaginatedProductVariantsResponseDto> {
    const { search, limit = 20, offset = 0 } = query;

    const { items, total } = await this.productsService.listVariants(
      { productId, search },
      { limit, offset }
    );

    return {
      items: items.map((v) => this.toVariantDto(v)),
      total,
      limit,
      offset,
    };
  }

  /**
   * The tax-rate provenance journal for one catalogue item (#2250, ADR-052 § 4).
   *
   * The journal's whole point is that "the shop changed it", "we wrote this to
   * the offer" and "somebody overwrote it afterwards" are separable facts, and
   * a stored value alone cannot separate them - so this is the read an operator
   * uses to attribute a shop-versus-channel disagreement instead of guessing.
   *
   * Scoped exactly the way the journal stores its rows: no `variantId` reads the
   * PRODUCT-level entries, and a `variantId` reads that variant's. The two are
   * deliberately not merged here - a variant with no override of its own has no
   * entries, and folding the product's in would present them as the variant's.
   */
  @Get(':productId/tax-rate-journal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tax-rate provenance journal for a product or variant',
    description:
      'Returns the latest journal entry per connection for one catalogue item: what the shop said, what OpenLinker wrote onto a channel, and what a channel reported back. Omit `variantId` for the product-level entries; pass one for that variant\'s.',
  })
  @ApiParam({ name: 'productId', description: 'Internal product ID (e.g. ol_product_...)' })
  @ApiQuery({
    name: 'variantId',
    required: false,
    description:
      'Internal variant ID (e.g. ol_variant_...). Omitted reads the product-level entries.',
  })
  @ApiResponse({
    status: 200,
    description: 'Latest tax-rate journal entry per connection',
    type: TaxRateJournalResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async getTaxRateJournal(
    @Param('productId') productId: string,
    @Query('variantId') variantId?: string
  ): Promise<TaxRateJournalResponseDto> {
    // A 404 for an unknown product rather than an empty list: an empty journal
    // is a real answer ("nothing has been observed yet") and must not be
    // indistinguishable from a mistyped id.
    const product = await this.productsService.getProduct(productId);
    if (!product) {
      throw new NotFoundException(`Product not found: ${productId}`);
    }

    const entries = await this.taxRateJournal.getLatestPerConnection(
      productId,
      variantId ?? null
    );
    return { items: entries.map((entry) => toTaxRateJournalEntryDto(entry)) };
  }

  private toProductDto(product: Product): ProductResponseDto {
    // Timestamps are optional on the Product interface because adapters produce
    // pre-persistence products. In this controller the product is always
    // repository-sourced (see ProductRepository#toDomain), so timestamps are
    // guaranteed present — non-null assertion crashes loudly if the invariant
    // ever breaks, which is preferable to silently emitting a 1970 epoch date.
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      currency: product.currency ?? null,
      description: product.description,
      images: product.images,
      categories: product.categories ?? null,
      ...(product.features ? { features: product.features } : {}),
      // #2255 — `undefined` and `null` are collapsed to `null` here on purpose:
      // the wire has one absence, and the STATE lives in `taxRateReadAt`.
      taxRate: product.taxRate ?? null,
      taxRateCountry: product.taxRateCountry ?? null,
      taxRateReadAt: product.taxRateReadAt?.toISOString() ?? null,
      createdAt: product.createdAt!.toISOString(),
      updatedAt: product.updatedAt!.toISOString(),
    };
  }

  private toVariantDto(variant: ProductVariant): ProductVariantResponseDto {
    return variantToDto(variant);
  }

  /**
   * Lightweight projection used by `GET /products/variants/:variantId` (#464).
   * Builds a human label from the variant's attribute map when present
   * (e.g. `{ color: 'Red', size: '42' }` → `"Red / 42"`); falls back to
   * undefined so the FE can render the SKU as the primary label. Sorts by
   * attribute key so the label is deterministic regardless of how the
   * variant came off the wire (JSONB column reads, future projections,
   * etc.) — `Object.values` would otherwise rely on insertion order.
   */
  private toVariantSummaryDto(variant: ProductVariant): ProductVariantSummaryResponseDto {
    const attributeValues = Object.entries(variant.attributes ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
    return {
      id: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      ean: variant.ean ?? null,
      name: attributeValues.length > 0 ? attributeValues.join(' / ') : undefined,
    };
  }

  private toExternalIdDto(mapping: {
    externalId: string;
    platformType: string;
    connectionId: string;
  }): ExternalIdMappingDto {
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
@ApiBearerAuth()
@ApiTags('variants')
@Controller('variants')
export class VariantsController {
  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService
  ) {}

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search variants',
    description: 'Search variants across all products by SKU, EAN, or GTIN.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated variant search results',
    type: PaginatedProductVariantsResponseDto,
  })
  async searchVariants(
    @Query() query: ListProductVariantsQueryDto
  ): Promise<PaginatedProductVariantsResponseDto> {
    const { search, limit = 20, offset = 0 } = query;

    const { items, total } = await this.productsService.listVariants({ search }, { limit, offset });

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
