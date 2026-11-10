/**
 * Promotions Controller (#3935)
 *
 * The operator surface for promotions: list, create, edit, delete, reorder,
 * resume after a cap, and a dry run on a sample order. Reads are admin, operator
 * and viewer; writes are admin and operator - adding a gift line is reversible
 * until the parcel is closed, so it does not carry the money acknowledgement the
 * `/automations` writes do.
 *
 * @module apps/api/src/promotions/http
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ORDER_GIFT_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderGiftService,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import {
  PROMOTION_APPLICATION_LOG_TOKEN,
  type PromotionApplicationLogPort,
  PROMOTION_SERVICE_TOKEN,
  type IPromotionService,
  type Promotion,
} from '@openlinker/core/promotions';

import {
  CUSTOMER_PROJECTION_SERVICE_TOKEN,
  type ICustomerProjectionService,
} from '@openlinker/core/customers';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  EvaluatePromotionsDto,
  PromotionDryRunResponseDto,
  PromotionHistoryResponseDto,
  PromotionResponseDto,
  ReorderPromotionsDto,
  ResumePromotionDto,
  WritePromotionDto,
} from './dto/promotion.dto';
import { codedHttpError } from '../../common/errors/coded-http.exception';

const HISTORY_LIMIT = 20;

@ApiBearerAuth()
@ApiTags('promotions')
@Controller('promotions')
export class PromotionsController {
  constructor(
    @Inject(PROMOTION_SERVICE_TOKEN)
    private readonly promotions: IPromotionService,
    @Inject(ORDER_GIFT_SERVICE_TOKEN)
    private readonly orderGifts: IOrderGiftService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    @Inject(CUSTOMER_PROJECTION_SERVICE_TOKEN)
    private readonly customers: ICustomerProjectionService,
    @Inject(PROMOTION_APPLICATION_LOG_TOKEN)
    private readonly applications: PromotionApplicationLogPort
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'List promotions in list order',
    description:
      'List order is the order stacking is defined against: a promotion that applied stops the ones ' +
      'below it. Each row carries what the promotion has given (`unitsGiven` of `effectiveCap`) and why it is paused.',
  })
  @ApiResponse({ status: 200, type: [PromotionResponseDto] })
  async list(): Promise<PromotionResponseDto[]> {
    const now = new Date();
    return (await this.promotions.list()).map((view) => PromotionResponseDto.fromView(view, now));
  }

  // DECLARED BEFORE `:id` routes - Nest matches in declaration order.
  @Put('order')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Reorder the promotions',
    description:
      'Exhaustive: the body must name EVERY promotion exactly once. A partial list is refused with the missing ' +
      'and unknown ids reported separately, and nothing is written.',
  })
  @ApiResponse({ status: 200, type: [PromotionResponseDto] })
  @ApiResponse({ status: 400, description: 'The list is not exactly the set of promotions' })
  async reorder(@Body() dto: ReorderPromotionsDto): Promise<PromotionResponseDto[]> {
    const now = new Date();
    return (await this.promotions.reorder(dto.promotionIds)).map((view) =>
      PromotionResponseDto.fromView(view, now)
    );
  }

  @Post('evaluate')
  // A viewer may run the Test panel: it writes nothing (no gift, ledger row or pause).
  @Roles('admin', 'operator', 'viewer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dry run - which promotions would apply to that order, and why not',
    description:
      'Writes nothing: no gift line, no ledger row, no pause. Evaluates every saved promotion in list order ' +
      '(plus an optional unsaved `promotion` draft) and names the reason each one would not apply. The ' +
      'retroactivity floor is waived so a promotion can be tested against any order; the verdict reports the waiver.',
  })
  @ApiResponse({ status: 200, type: PromotionDryRunResponseDto })
  @ApiResponse({ status: 404, description: 'Order or customer not found' })
  async evaluate(@Body() dto: EvaluatePromotionsDto): Promise<PromotionDryRunResponseDto> {
    const record = await this.orders.getOrderRecord(dto.orderId);
    if (record === null)
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'ORDER_NOT_FOUND',
        `Order "${dto.orderId}" not found.`,
        {
          orderId: dto.orderId,
        }
      );

    if (dto.customerId !== undefined) {
      const customer = await this.customers.getProjection(dto.customerId);
      if (customer === null)
        throw codedHttpError(
          HttpStatus.NOT_FOUND,
          'CUSTOMER_NOT_FOUND',
          `Customer "${dto.customerId}" not found.`,
          { customerId: dto.customerId }
        );
    }

    let draft: Promotion | undefined;
    if (dto.promotion !== undefined) draft = this.promotions.buildDraft(dto.promotion.toInput());
    const preview = await this.orderGifts.previewForOrder({
      record,
      ...(draft && { draft }),
      ...(dto.customerId !== undefined && { customerId: dto.customerId }),
    });
    return PromotionDryRunResponseDto.from(
      dto.orderId,
      preview.evaluatedAt,
      preview.evaluations,
      preview.outcomes,
      draft?.id ?? dto.promotionId ?? null,
      preview.customerLimits
    );
  }

  @Get(':id')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Read one promotion' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: PromotionResponseDto })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<PromotionResponseDto> {
    return PromotionResponseDto.fromView(await this.promotions.get(id));
  }

  @Get(':id/history')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'What happened when this promotion met an order',
    description:
      'The newest applications first (applied, skipped, failed), with the order number and a reason code. ' +
      'Reason codes only: no message text, cost or buyer data.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: PromotionHistoryResponseDto })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  async history(
    @Param('id', new ParseUUIDPipe()) id: string
  ): Promise<PromotionHistoryResponseDto> {
    await this.promotions.get(id);
    const records = await this.applications.findByPromotion(id, HISTORY_LIMIT);
    const newestFirst = [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const numbers = await Promise.all(
      newestFirst.map(async (record) => {
        const order = await this.orders.getOrderRecord(record.internalOrderId);
        return order?.orderNumber ?? null;
      })
    );
    return PromotionHistoryResponseDto.from(newestFirst, numbers);
  }

  @Post()
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'Create a promotion' })
  @ApiResponse({ status: 201, type: PromotionResponseDto })
  @ApiResponse({ status: 400, description: 'Malformed condition or benefit' })
  @ApiResponse({
    status: 409,
    description: 'An identical promotion already covers an overlapping window',
  })
  async create(@Body() dto: WritePromotionDto): Promise<PromotionResponseDto> {
    return PromotionResponseDto.fromView(await this.promotions.create(dto.toInput()));
  }

  @Put(':id')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Replace a promotion',
    description:
      'A full replace. Editing a promotion never changes an open order: gifts already added stay as they were. ' +
      'Its place in the list, what it has given and its pause state are kept.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: PromotionResponseDto })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  async replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: WritePromotionDto
  ): Promise<PromotionResponseDto> {
    return PromotionResponseDto.fromView(await this.promotions.update(id, dto.toInput()));
  }

  @Post(':id/resume')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume a promotion that stopped at its unit cap',
    description:
      'Explicit on purpose: the operator decides whether the promotion goes on. Adds `additionalUnits` to the ' +
      'cap and lifts the pause. A promotion paused because the gift is out of stock resumes by itself when stock returns.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: PromotionResponseDto })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  async resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResumePromotionDto
  ): Promise<PromotionResponseDto> {
    return PromotionResponseDto.fromView(
      await this.promotions.resumeAfterCap(id, dto.additionalUnits)
    );
  }

  @Delete(':id')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a promotion',
    description: 'Gifts already added stay; the ledger keeps its history.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.promotions.delete(id);
  }
}
