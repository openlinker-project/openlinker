/**
 * Gift Attention Controller (#3935)
 *
 * The two gift-only doors onto an order's promotion applications: read why a gift
 * is missing, and record "send without the gift". Narrower than the order's full
 * history on purpose: it answers only for promotions that did not give their
 * benefit and returns reason codes, never message text, cost or buyer data.
 *
 * @module apps/api/src/promotions/http/gift-attention.controller
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  PROMOTION_APPLICATION_LOG_TOKEN,
  type PromotionApplicationLogPort,
  type PromotionApplicationRecord,
} from '@openlinker/core/promotions';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { Roles } from '../../auth/decorators/roles.decorator';
import { GiftAttentionItemDto, GiftAttentionResponseDto } from './dto/gift-attention.dto';
import { codedHttpError } from '../../common/errors/coded-http.exception';

const LOG_WINDOW = 200;

function toItem(record: PromotionApplicationRecord): GiftAttentionItemDto {
  const item = new GiftAttentionItemDto();
  item.runId = record.id;
  item.ruleId = record.promotionId;
  item.ruleName = record.promotionName;
  item.outcome = record.outcome === 'failed' ? 'failed' : 'not-applied';
  item.reasonCode = record.outcome === 'failed' ? null : record.reason;
  item.dismissed = record.dismissedAt !== null;
  item.firedAt = record.createdAt.toISOString();
  return item;
}

@ApiBearerAuth()
@ApiTags('gift-attention')
@Controller('orders/:internalOrderId/gift-attention')
export class GiftAttentionController {
  constructor(
    @Inject(PROMOTION_APPLICATION_LOG_TOKEN)
    private readonly log: PromotionApplicationLogPort
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'Promotion applications of this order that did not give their gift',
    description:
      'Only failed or not-applied applications, one per promotion (the latest). Reason codes only: ' +
      'no message text, cost or buyer data.',
  })
  @ApiParam({ name: 'internalOrderId', type: String })
  @ApiResponse({ status: 200, type: GiftAttentionResponseDto })
  async list(@Param('internalOrderId') internalOrderId: string): Promise<GiftAttentionResponseDto> {
    const records = await this.log.findByOrder(internalOrderId, LOG_WINDOW);
    const newestFirst = [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const seen = new Set<string>();
    const items: GiftAttentionItemDto[] = [];
    for (const record of newestFirst) {
      if (seen.has(record.promotionId)) continue;
      seen.add(record.promotionId);
      if (record.outcome === 'applied') continue;
      items.push(toItem(record));
    }
    const dto = new GiftAttentionResponseDto();
    dto.items = items;
    dto.recordingAvailable = true;
    return dto;
  }

  @Post(':runId/skip')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Send this order without the gift',
    description:
      'Records that a person handled this application. The record stays as it was; only the ' +
      "attention state clears. 404 when the record is not this order's.",
  })
  @ApiParam({ name: 'internalOrderId', type: String })
  @ApiParam({ name: 'runId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: GiftAttentionItemDto })
  @ApiResponse({ status: 404, description: 'No such application on this order' })
  async skip(
    @Param('internalOrderId') internalOrderId: string,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<GiftAttentionItemDto> {
    const record = await this.log.findById(runId);
    if (record === null || record.internalOrderId !== internalOrderId) {
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'GIFT_RUN_NOT_FOUND',
        `No gift run "${runId}" on order "${internalOrderId}".`,
        { runId, orderId: internalOrderId }
      );
    }
    const dismissed = await this.log.dismiss(runId, user.id, new Date());
    if (dismissed === null) {
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'GIFT_RUN_NOT_FOUND',
        `No gift run "${runId}" on order "${internalOrderId}".`,
        { runId, orderId: internalOrderId }
      );
    }
    return toItem(dismissed);
  }
}
