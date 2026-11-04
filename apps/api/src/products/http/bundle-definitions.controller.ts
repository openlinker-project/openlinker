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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BUNDLE_DEFINITION_SERVICE_TOKEN,
  BundleDefinitionAlreadyExistsError,
  BundleDefinitionInvalidError,
  BundleDefinitionNotFoundError,
  BundleNestingError,
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
import {
  BundleDefinitionResponseDto,
  BundleWithAvailabilityResponseDto,
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
    private readonly availability: IAvailabilityService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({ summary: 'List the current bundle definitions' })
  @ApiResponse({ status: 200, type: [BundleDefinitionResponseDto] })
  async list(): Promise<BundleDefinitionResponseDto[]> {
    return (await this.bundles.list()).map(toDto);
  }

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Define a bundle',
    description:
      'Refused with 409 BUNDLE_NESTING_REFUSED when a component is itself a bundle, or the variant is already a component of another bundle.',
  })
  @ApiResponse({ status: 201, type: BundleDefinitionResponseDto })
  async create(@Body() body: CreateBundleDefinitionRequestDto): Promise<BundleDefinitionResponseDto> {
    try {
      return toDto(await this.bundles.create(body.variantId, body.components));
    } catch (error) {
      return mapError(error);
    }
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
    const [rows, [bundleAvailability]] = await Promise.all([
      this.inventoryQuery.getAvailabilityByVariantIds(definition.components.map((c) => c.variantId)),
      // The SAME function publishing uses, so the number shown is the number
      // published (global scope: no per-channel buffer on an operator read).
      this.availability.getPromisableQuantities({ variantIds: [variantId], scope: { kind: 'global' } }),
    ]);
    const atpByVariant = new Map(rows.map((row) => [row.productVariantId, row.availableToPromise]));
    const componentAvailability = definition.components.map((c) => {
      const atp = atpByVariant.get(c.variantId) ?? null;
      return {
        variantId: c.variantId,
        productId: c.productId,
        quantity: c.quantity,
        ...(c.giftSlot === true && { giftSlot: true }),
        availableToPromise: atp,
        bundlesSupported: atp === null ? null : Math.floor(atp / c.quantity),
      };
    });
    return {
      ...toDto(definition),
      componentAvailability,
      // `null` when OL does not know (provenance 'unknown'), never 0.
      bundlesAvailable: bundleAvailability?.quantity ?? null,
    };
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
