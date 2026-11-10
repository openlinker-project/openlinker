/**
 * Bundle Definitions Controller (#3607, ADR-083)
 *
 * CRUD for a bundle's composition, and a read that adds per-component
 * availability. Writes are admin + operator; reads also viewer. A packer
 * reaches none of it. A definition edit never changes an open order: orders
 * carry their own frozen expansion.
 *
 * @module apps/api/src/products/http
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ORDER_PROVISIONING_RESUME_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderProvisioningResumeService,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import {
  BUNDLE_DEFINITION_SERVICE_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
  type IProductsService,
  BundleDefinitionAlreadyExistsError,
  BundleDefinitionInvalidError,
  BundleDefinitionNotFoundError,
  BundleMasterSyncRefusedError,
  BundleNestingError,
  BUNDLE_MASTER_SYNC_SERVICE_TOKEN,
  type IBundleMasterSyncService,
  type BundleDefinition,
  type IBundleDefinitionService,
} from '@openlinker/core/products';
import {
  AVAILABILITY_SERVICE_TOKEN,
  INVENTORY_QUERY_SERVICE_TOKEN,
  type IAvailabilityService,
  type IInventoryQueryService,
} from '@openlinker/core/inventory';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { productImageProxyPath } from './product-image-path';
import type {
  BundleProductSummaryDto} from './dto/bundle-definition.dto';
import {
  BundleCreatedResponseDto,
  BundleDefinitionResponseDto,
  BundleHistoryEntryResponseDto,
  BundleUsedInResponseDto,
  ConfirmMultipackRequestDto,
  MultipackConfirmedResponseDto,
  BundleWithAvailabilityResponseDto,
  MasterBundleCompositionResponseDto,
  CreateBundleDefinitionRequestDto,
  UpdateBundleDefinitionRequestDto,
} from './dto/bundle-definition.dto';

function toDto(definition: BundleDefinition): BundleDefinitionResponseDto {
  return {
    variantId: definition.variantId,
    version: definition.version,
    components: definition.components.map((c) => ({
      variantId: c.variantId,
      productId: c.productId,
      quantity: c.quantity,
      ...(c.giftSlot === true && { giftSlot: true }),
      ...(c.giftSlot === true && c.documentForm !== undefined && { documentForm: c.documentForm }),
    })),
  };
}

/** Domain error -> HTTP, with the stable machine-readable `code` an operator surface branches on. */
function mapError(error: unknown): never {
  if (error instanceof BundleNestingError) {
    throw new ConflictException({ code: error.code, reason: error.reason, message: error.message });
  }
  if (error instanceof BundleDefinitionAlreadyExistsError) {
    throw new ConflictException({ code: error.code, message: error.message });
  }
  if (error instanceof BundleDefinitionNotFoundError) {
    throw new NotFoundException({ code: error.code, message: error.message });
  }
  if (error instanceof BundleMasterSyncRefusedError) {
    // The product or the master says no (not a pack, a component not synced yet,
    // no master): a state the operator fixes, not a malformed request.
    throw new UnprocessableEntityException({
      code: error.code,
      reason: error.reason,
      unmappedComponents: error.unmappedComponents,
      message: error.message,
    });
  }
  if (error instanceof BundleDefinitionInvalidError) {
    throw new BadRequestException({ code: error.code, message: error.message });
  }
  throw error;
}

@ApiBearerAuth()
@ApiTags('bundle-definitions')
@Controller('bundle-definitions')
export class BundleDefinitionsController {
  constructor(
    @Inject(BUNDLE_DEFINITION_SERVICE_TOKEN)
    private readonly bundles: IBundleDefinitionService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availability: IAvailabilityService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(ORDER_PROVISIONING_RESUME_SERVICE_TOKEN)
    private readonly provisioningResume: IOrderProvisioningResumeService,
    @Inject(BUNDLE_MASTER_SYNC_SERVICE_TOKEN)
    private readonly masterSync: IBundleMasterSyncService
  ) {}

  /** Name, SKU and gross price per variant, in one batched read (never per row). */
  private async summarise(
    variantIds: readonly string[]
  ): Promise<Map<string, BundleProductSummaryDto>> {
    const unique = [...new Set(variantIds)];
    const result = new Map<string, BundleProductSummaryDto>();
    if (unique.length === 0) {
      return result;
    }
    const variants = await this.products.getVariantsByIds(unique);
    const productList = await this.products.getProductsByIds([
      ...new Set(variants.map((v) => v.productId)),
    ]);
    const productById = new Map(productList.map((p) => [p.id, p]));
    for (const variant of variants) {
      const product = productById.get(variant.productId);
      result.set(variant.id, {
        name: product?.name ?? null,
        sku: variant.sku,
        price: variant.price ?? product?.price ?? null,
        currency: product?.currency ?? null,
        imageUrl: productImageProxyPath(product),
      });
    }
    return result;
  }

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({
    summary: 'List the current bundle definitions',
    description:
      'With `variantIds` (comma separated, at most 200) only the definitions of those variants are returned, ' +
      'and an empty list means none of them is a bundle: an answer, where `GET :variantId` would be a 404.',
  })
  @ApiResponse({ status: 200, type: [BundleDefinitionResponseDto] })
  async list(@Query('variantIds') variantIds?: string): Promise<BundleDefinitionResponseDto[]> {
    if (variantIds === undefined) {
      return (await this.bundles.list()).map(toDto);
    }
    const ids = [
      ...new Set(
        variantIds
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      ),
    ].slice(0, 200);
    if (ids.length === 0) {
      return [];
    }
    return (await this.bundles.findCurrentByVariantIds(ids)).map(toDto);
  }

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Define a bundle',
    description:
      'Refused with 409 BUNDLE_NESTING_REFUSED when a component is itself a bundle, or the variant is already a component of another bundle.',
  })
  @ApiResponse({ status: 201, type: BundleCreatedResponseDto })
  async create(@Body() body: CreateBundleDefinitionRequestDto): Promise<BundleCreatedResponseDto> {
    let created: BundleDefinition;
    try {
      created = await this.bundles.create(body.variantId, body.components);
    } catch (error) {
      return mapError(error);
    }
    // #3624: orders held because a multipack had no bundle are sent through
    // ingestion again now, not at their next retry backoff. Never fails the
    // create - the definition is already saved.
    const released = await this.provisioningResume.resumeMultipackHeldOrders({
      variantId: body.variantId,
    });
    return { ...toDto(created), releasedOrders: released.enqueued };
  }

  @Roles('admin', 'operator')
  @Post('multipack-confirmations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm that an offer sold as N units of a product means N units of it',
    description:
      'Creates no product. Idempotent: confirming again still re-drives the held orders. ' +
      'Every order held for this variant at this pack quantity is sent to be processed again now (#3624).',
  })
  @ApiResponse({ status: 200, type: MultipackConfirmedResponseDto })
  async confirmMultipack(
    @Body() body: ConfirmMultipackRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<MultipackConfirmedResponseDto> {
    try {
      await this.bundles.confirmMultipack(
        { variantId: body.variantId, packQuantity: body.packQuantity },
        user.id
      );
    } catch (error) {
      return mapError(error);
    }
    const released = await this.provisioningResume.resumeMultipackHeldOrders({
      variantId: body.variantId,
      packQuantity: body.packQuantity,
    });
    return {
      variantId: body.variantId,
      packQuantity: body.packQuantity,
      releasedOrders: released.enqueued,
    };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('used-in')
  @ApiOperation({
    summary: 'The bundles that hold any of the given products as a component',
    description: 'One batched reverse lookup for a product with several variants (#3624).',
  })
  @ApiResponse({ status: 200, type: [BundleUsedInResponseDto] })
  async usedInMany(@Query('variantIds') variantIds?: string): Promise<BundleUsedInResponseDto[]> {
    const ids = [
      ...new Set(
        (variantIds ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      ),
    ].slice(0, 200);
    if (ids.length === 0) {
      return [];
    }
    const containing = await this.bundles.findCurrentContainingComponents(ids);
    const summaries = await this.summarise(containing.map((d) => d.variantId));
    const idSet = new Set(ids);
    return containing.flatMap((definition) => {
      // One row per (bundle, component variant): two variants of one product in
      // the same bundle are two rows, told apart by `componentVariantId`.
      return definition.components
        .filter((c) => idSet.has(c.variantId))
        .map((component) => ({
          bundleVariantId: definition.variantId,
          componentVariantId: component.variantId,
          quantity: component.quantity,
          ...(component.giftSlot === true && { giftSlot: true }),
          bundle: summaries.get(definition.variantId) ?? {
            name: null,
            sku: null,
            price: null,
            currency: null,
            imageUrl: null,
          },
        }));
    });
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('used-in/:variantId')
  @ApiOperation({
    summary: 'The bundles that hold a product as a component',
    description: 'Reverse lookup (#3624). Nesting is refused, so a bundle never shows up here as a component.',
  })
  @ApiResponse({ status: 200, type: [BundleUsedInResponseDto] })
  async usedIn(@Param('variantId') variantId: string): Promise<BundleUsedInResponseDto[]> {
    const containing = await this.bundles.findCurrentContainingComponents([variantId]);
    const summaries = await this.summarise(containing.map((d) => d.variantId));
    return containing.map((definition) => {
      const component = definition.components.find((c) => c.variantId === variantId);
      return {
        bundleVariantId: definition.variantId,
        quantity: component?.quantity ?? 1,
        ...(component?.giftSlot === true && { giftSlot: true }),
        bundle: summaries.get(definition.variantId) ?? {
          name: null,
          sku: null,
          price: null,
          currency: null,
          imageUrl: null,
        },
      };
    });
  }

  @Roles('admin', 'operator', 'viewer')
  @Get(':variantId/history')
  @ApiOperation({
    summary: 'Every version of a bundle, newest first',
    description:
      'Each version carries how many open orders were frozen with it, so an operator can see which orders still ship an older composition (#3624).',
  })
  @ApiResponse({ status: 200, type: [BundleHistoryEntryResponseDto] })
  async history(@Param('variantId') variantId: string): Promise<BundleHistoryEntryResponseDto[]> {
    const versions = await this.bundles.history(variantId);
    if (versions.length === 0) {
      throw new NotFoundException({
        code: 'BUNDLE_DEFINITION_NOT_FOUND',
        message: `No bundle definition for variant ${variantId}`,
      });
    }
    const [counts, summaries] = await Promise.all([
      this.orderRecords.countOpenOrdersByBundleVersion(variantId),
      this.summarise(versions.flatMap((v) => v.components.map((c) => c.variantId))),
    ]);
    const countByVersion = new Map(counts.map((c) => [c.version, c.count]));
    const newest = Math.max(...versions.map((v) => v.version));
    return [...versions]
      .sort((a, b) => b.version - a.version)
      .map((version) => ({
        ...toDto(version),
        // A deleted bundle retires every version, so none is in force.
        current: version.version === newest && version.retired !== true,
        createdAt: version.createdAt.toISOString(),
        openOrders: countByVersion.get(version.version) ?? 0,
        componentSummaries: version.components.map(
          (c) => summaries.get(c.variantId) ?? { name: null, sku: null, price: null, currency: null, imageUrl: null }
        ),
      }));
  }

  @Roles('admin', 'operator', 'viewer')
  @Get(':variantId')
  @ApiOperation({
    summary: 'Read a bundle with per-component availability',
    description:
      'Availability is read from OpenLinker\'s own positions, net of its holds. A component whose availability is unknown reads null, never zero.',
  })
  @ApiResponse({ status: 200, type: BundleWithAvailabilityResponseDto })
  async get(@Param('variantId') variantId: string): Promise<BundleWithAvailabilityResponseDto> {
    const definition = await this.bundles.get(variantId);
    if (definition === null) {
      throw new NotFoundException({
        code: 'BUNDLE_DEFINITION_NOT_FOUND',
        message: `No bundle definition for variant ${variantId}`,
      });
    }
    const [bundleVariant] = await this.products.getVariantsByIds([variantId]);
    const [rows, [bundleAvailability], summaries, versionCounts, master] = await Promise.all([
      this.inventoryQuery.getAvailabilityByVariantIds(definition.components.map((c) => c.variantId)),
      // The SAME function publishing uses, so the number shown is the number
      // published (global scope: no per-channel buffer on an operator read).
      this.availability.getPromisableQuantities({ variantIds: [variantId], scope: { kind: 'global' } }),
      this.summarise([variantId, ...definition.components.map((c) => c.variantId)]),
      this.orderRecords.countOpenOrdersByBundleVersion(variantId),
      // One variant, one probe: never run per list row. A master that cannot be
      // resolved reads as "cannot sync", not as a failed detail read.
      this.masterSync.findBundleReadingMaster(variantId).catch(() => null),
    ]);
    const emptySummary: BundleProductSummaryDto = { name: null, sku: null, price: null, currency: null, imageUrl: null };
    const atpByVariant = new Map(rows.map((row) => [row.productVariantId, row.availableToPromise]));
    const componentAvailability = definition.components.map((c) => {
      const atp = atpByVariant.get(c.variantId) ?? null;
      return {
        variantId: c.variantId,
        productId: c.productId,
        quantity: c.quantity,
        ...(c.giftSlot === true && { giftSlot: true }),
        ...(c.giftSlot === true && c.documentForm !== undefined && { documentForm: c.documentForm }),
        summary: summaries.get(c.variantId) ?? emptySummary,
        availableToPromise: atp,
        bundlesSupported: atp === null ? null : Math.floor(atp / c.quantity),
      };
    });
    return {
      ...toDto(definition),
      productId: bundleVariant?.productId ?? null,
      composedByMaster: master,
      bundle: summaries.get(variantId) ?? emptySummary,
      openOrdersOnOlderComposition: versionCounts
        .filter((entry) => entry.version < definition.version)
        .reduce((sum, entry) => sum + entry.count, 0),
      componentAvailability,
      // `null` when OL does not know (provenance 'unknown'), never 0.
      bundlesAvailable: bundleAvailability?.quantity ?? null,
    };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get(':variantId/master-composition')
  @ApiOperation({
    summary: 'What the product master currently says this bundle contains (read-only)',
    description: 'Writes nothing. 422 BUNDLE_MASTER_SYNC_REFUSED names why the master cannot answer (#3932).',
  })
  @ApiResponse({ status: 200, type: MasterBundleCompositionResponseDto })
  async masterComposition(
    @Param('variantId') variantId: string
  ): Promise<MasterBundleCompositionResponseDto> {
    try {
      return await this.masterSync.previewComposition(variantId);
    } catch (error) {
      return mapError(error);
    }
  }

  @Roles('admin', 'operator')
  @Post(':variantId/sync-from-master')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Write the master\'s composition as the next version of this bundle',
    description:
      'Runs only on this explicit call. Never edits an existing version, so open orders keep the composition they were frozen with. ' +
      '422 BUNDLE_MASTER_SYNC_REFUSED when the master cannot read bundles, the product is not a pack there, or a component is not synced into OpenLinker (#3932).',
  })
  @ApiResponse({ status: 200, type: BundleDefinitionResponseDto })
  async syncFromMaster(@Param('variantId') variantId: string): Promise<BundleDefinitionResponseDto> {
    try {
      return toDto(await this.masterSync.syncFromMaster(variantId));
    } catch (error) {
      return mapError(error);
    }
  }

  @Roles('admin', 'operator')
  @Put(':variantId')
  @ApiOperation({
    summary: 'Write the next version of a bundle definition',
    description: 'Open orders keep the composition they were frozen with.',
  })
  @ApiResponse({ status: 200, type: BundleDefinitionResponseDto })
  async update(
    @Param('variantId') variantId: string,
    @Body() body: UpdateBundleDefinitionRequestDto
  ): Promise<BundleDefinitionResponseDto> {
    try {
      return toDto(await this.bundles.update(variantId, body.components));
    } catch (error) {
      return mapError(error);
    }
  }

  @Roles('admin', 'operator')
  @Delete(':variantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retire a bundle definition (history is kept)' })
  @ApiResponse({ status: 204 })
  async remove(@Param('variantId') variantId: string): Promise<void> {
    try {
      await this.bundles.delete(variantId);
    } catch (error) {
      mapError(error);
    }
  }
}
