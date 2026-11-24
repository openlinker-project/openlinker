/**
 * Buyer Data Retention Controller (#4289)
 *
 * `POST /orders/buyer-data-retention/preview` is the trial run an admin must
 * look at before switching retention on: how many orders the given rule would
 * hide and erase, how many it would skip as protected, and a few masked
 * examples. It writes nothing and its answer carries no personal data.
 *
 * Admin-only: the counts describe the whole order book.
 *
 * @module apps/api/src/orders/http
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BUYER_DATA_RETENTION_SERVICE_TOKEN,
  type IBuyerDataRetentionService,
} from '@openlinker/core/orders';
import {
  isBuyerDataPeriodOrderValid,
  isValidBuyerDataPeriod,
} from '@openlinker/core/operational-settings';
import { Roles } from '../../auth/decorators/roles.decorator';
import { codedHttpError } from '../../common/errors/coded-http.exception';
import {
  BuyerDataAgeHistogramQueryDto,
  BuyerDataAgeHistogramResponseDto,
  BuyerDataRetentionPreviewRequestDto,
  BuyerDataRetentionPreviewResponseDto,
} from './dto/buyer-data-retention-preview.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/buyer-data-retention')
export class BuyerDataRetentionController {
  constructor(
    @Inject(BUYER_DATA_RETENTION_SERVICE_TOKEN)
    private readonly retention: IBuyerDataRetentionService
  ) {}

  @Roles('admin')
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Trial run: count the orders a retention rule would hide and erase, without changing anything',
  })
  @ApiResponse({ status: 200, type: BuyerDataRetentionPreviewResponseDto })
  @ApiResponse({
    status: 400,
    description: 'A period is out of range or the erase period is shorter than the hide period.',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async preview(
    @Body() dto: BuyerDataRetentionPreviewRequestDto
  ): Promise<BuyerDataRetentionPreviewResponseDto> {
    if (!isValidBuyerDataPeriod(dto.hideAfterDays) || !isValidBuyerDataPeriod(dto.eraseAfterDays)) {
      throw codedHttpError(
        HttpStatus.BAD_REQUEST,
        'OPERATIONAL_SETTING_INVALID',
        'A period must be 0 (never) or a whole number of days between 30 and 3650',
        { field: 'hideAfterDays', rule: 'buyer-data-period' }
      );
    }
    if (!isBuyerDataPeriodOrderValid(dto.hideAfterDays, dto.eraseAfterDays)) {
      throw codedHttpError(
        HttpStatus.BAD_REQUEST,
        'OPERATIONAL_SETTING_INVALID',
        'The erase period must not be shorter than the hide period',
        { field: 'eraseAfterDays', rule: 'buyer-data-order', limit: dto.hideAfterDays }
      );
    }
    return BuyerDataRetentionPreviewResponseDto.fromPreview(
      await this.retention.preview({
        ...(dto.connectionId !== undefined && { connectionId: dto.connectionId }),
        hideAfterDays: dto.hideAfterDays,
        eraseAfterDays: dto.eraseAfterDays,
        mode: dto.mode,
      })
    );
  }

  @Roles('admin')
  @Get('age-histogram')
  @ApiOperation({
    summary: 'Age distribution of the order book in 30-day buckets, split visible, hidden, erased',
  })
  @ApiResponse({ status: 200, type: BuyerDataAgeHistogramResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async ageHistogram(
    @Query() query: BuyerDataAgeHistogramQueryDto
  ): Promise<BuyerDataAgeHistogramResponseDto> {
    return BuyerDataAgeHistogramResponseDto.fromHistogram(
      await this.retention.getAgeHistogram(query.connectionId)
    );
  }
}
