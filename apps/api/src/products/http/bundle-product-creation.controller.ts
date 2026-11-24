/**
 * Bundle Product Creation Controller (#3935)
 *
 * Makes a new product for a bundle at a product master. The bundle's composition
 * is then written with the ordinary bundle-definitions endpoints.
 *
 * @module apps/api/src/products/http
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BUNDLE_PRODUCT_CREATION_SERVICE_TOKEN,
  BundleProductCreationRefusedError,
  type IBundleProductCreationService,
} from '@openlinker/core/products';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  BundleCreationTargetResponseDto,
  CreatedBundleProductResponseDto,
  CreateBundleProductRequestDto,
} from './dto/bundle-product-creation.dto';

@ApiBearerAuth()
@ApiTags('bundle-product-creation')
@Controller('bundle-product-creation')
export class BundleProductCreationController {
  constructor(
    @Inject(BUNDLE_PRODUCT_CREATION_SERVICE_TOKEN)
    private readonly creation: IBundleProductCreationService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('targets')
  @ApiOperation({ summary: 'Product masters, and whether each can create a product from OpenLinker' })
  @ApiResponse({ status: 200, type: [BundleCreationTargetResponseDto] })
  async targets(): Promise<BundleCreationTargetResponseDto[]> {
    return this.creation.listTargets();
  }

  @Roles('admin', 'operator')
  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create the product a new bundle will be sold as, at a product master',
    description:
      'Idempotent on SKU. Refused with 422 BUNDLE_PRODUCT_CREATION_REFUSED when the master cannot create products or refuses this one.',
  })
  @ApiResponse({ status: 201, type: CreatedBundleProductResponseDto })
  async create(
    @Body() body: CreateBundleProductRequestDto
  ): Promise<CreatedBundleProductResponseDto> {
    try {
      return await this.creation.createBundleProduct(body);
    } catch (error) {
      if (error instanceof BundleProductCreationRefusedError) {
        throw new UnprocessableEntityException({
          code: error.code,
          reason: error.reason,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
