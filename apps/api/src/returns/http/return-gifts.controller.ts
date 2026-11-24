/**
 * Return Gifts Controller (#3943, gifts spec section 9, rule G5)
 *
 * `GET /returns/:returnId/gifts` lists the gifts the order carries with the
 * operator's decision on each; `PUT .../:giftLineId/decision` records one. OpenLinker
 * never deducts a gift on its own: nothing here touches the refund, and a gift with
 * no decision is simply undecided. Composed at the app layer because the gifts
 * live on the order (`orders`) and the decision on the return (`returns`), and
 * `returns` must not import `orders`.
 *
 * @module apps/api/src/returns/http
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  RETURN_GIFT_DECISION_SERVICE_TOKEN,
  RETURNS_SERVICE_TOKEN,
  ReturnGiftDecisionInvalidError,
  type IReturnGiftDecisionService,
  type IReturnsService,
  type ReturnGiftDecision,
} from '@openlinker/core/returns';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { DecideReturnGiftDto, ReturnGiftDto, ReturnGiftsResponseDto } from '../dto/return-gift.dto';
import { codedHttpError } from '../../common/errors/coded-http.exception';

const round2 = (value: number): number => Math.round(value * 100) / 100;

@ApiBearerAuth()
@ApiTags('returns')
@Controller('returns')
export class ReturnGiftsController {
  constructor(
    @Inject(RETURNS_SERVICE_TOKEN) private readonly returns: IReturnsService,
    @Inject(RETURN_GIFT_DECISION_SERVICE_TOKEN)
    private readonly decisions: IReturnGiftDecisionService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN) private readonly orderRecords: IOrderRecordService,
    @Inject(PRODUCTS_SERVICE_TOKEN) private readonly products: IProductsService
  ) {}

  @Get(':returnId/gifts')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: "The gifts on the return's order and what the operator decided about each",
    description:
      'A read. An order with no gifts, or a return not yet attributed to an order, answers an empty list.',
  })
  @ApiResponse({ status: 200, type: ReturnGiftsResponseDto })
  async list(@Param('returnId') returnId: string): Promise<ReturnGiftsResponseDto> {
    const { gifts, currency } = await this.loadGifts(returnId);
    return {
      gifts,
      currency,
      refundDeductionGross: round2(
        gifts.reduce(
          (sum, gift) => sum + (gift.decision === 'deduct' ? gift.deductionGross ?? 0 : 0),
          0
        )
      ),
    };
  }

  @Put(':returnId/gifts/:giftLineId/decision')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Record keep, ask back or deduct for one gift on a return',
    description:
      'Replaces an earlier decision for the same gift. `deduct` takes the amount in the body, or the ' +
      "gift's standalone price when it is omitted. The refund itself is not changed.",
  })
  @ApiResponse({ status: 200, type: ReturnGiftDto })
  async decide(
    @Param('returnId') returnId: string,
    @Param('giftLineId') giftLineId: string,
    @Body() dto: DecideReturnGiftDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ReturnGiftDto> {
    const { gifts, validGiftLineIds } = await this.loadGifts(returnId);
    const gift = gifts.find((candidate) => candidate.giftLineId === giftLineId);
    if (gift === undefined) {
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'GIFT_LINE_NOT_FOUND',
        `Order of return ${returnId} carries no gift line ${giftLineId}`,
        { returnId, giftLineId }
      );
    }
    try {
      await this.decisions.decide({
        returnId,
        giftLineId,
        decision: dto.decision,
        deductionGross:
          dto.decision === 'deduct' ? dto.deductionGross ?? gift.standalonePriceGross : null,
        note: dto.note ?? null,
        actorUserId: user.id,
        validGiftLineIds,
      });
    } catch (error) {
      if (error instanceof ReturnGiftDecisionInvalidError) {
        throw new BadRequestException({ message: error.message, reason: error.reason });
      }
      throw error;
    }
    const after = (await this.loadGifts(returnId)).gifts.find((c) => c.giftLineId === giftLineId);
    return after ?? gift;
  }

  private async loadGifts(
    returnId: string
  ): Promise<{ gifts: ReturnGiftDto[]; currency: string | null; validGiftLineIds: string[] }> {
    const record = await this.returns.getReturn(returnId);
    if (record === null) {
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'RETURN_NOT_FOUND',
        `Return not found: ${returnId}`,
        {
          returnId,
        }
      );
    }
    if (record.internalOrderId === null) {
      return { gifts: [], currency: null, validGiftLineIds: [] };
    }
    const order = await this.orderRecords.getOrderRecord(record.internalOrderId);
    if (order === null || order === undefined) {
      return { gifts: [], currency: null, validGiftLineIds: [] };
    }
    // A gift is either its own order line or a gift slot inside a set; both are
    // decided the same way, so both are listed.
    const giftSlotItems = order.physicalItems.filter((item) => item.giftSlot === true);
    const giftItems = [
      ...order.orderItems.filter((item) => item.gift !== undefined),
      ...giftSlotItems,
    ].filter((item) => item.quantity > 0);
    const decided = new Map<string, ReturnGiftDecision>(
      (await this.decisions.list(returnId)).map((d) => [d.giftLineId, d])
    );
    const variantIds = giftItems.flatMap((item) =>
      item.variantId === undefined ? [] : [item.variantId]
    );
    const variants = variantIds.length > 0 ? await this.products.getVariantsByIds(variantIds) : [];
    const productIds = [...new Set(variants.map((v) => v.productId))];
    const productList =
      productIds.length > 0 ? await this.products.getProductsByIds(productIds) : [];
    const productPrice = new Map(productList.map((p) => [p.id, p.price]));
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const gifts = giftItems.map((item): ReturnGiftDto => {
      const variant = item.variantId === undefined ? undefined : variantById.get(item.variantId);
      const unit =
        variant?.price ?? (variant === undefined ? undefined : productPrice.get(variant.productId));
      const decision = decided.get(item.id);
      return {
        giftLineId: item.id,
        sku: item.sku ?? variant?.sku ?? null,
        name: item.name ?? null,
        quantity: item.quantity,
        giftSource: item.gift?.source ?? 'channel',
        standalonePriceGross: typeof unit === 'number' ? round2(unit * item.quantity) : null,
        decision: decision?.decision ?? null,
        deductionGross: decision?.deductionGross == null ? null : Number(decision.deductionGross),
        note: decision?.note ?? null,
        decidedAt: decision?.decidedAt.toISOString() ?? null,
      };
    });
    // What `returns` may record a decision against: the order's gift lines and the
    // gift slots of its sets, resolved HERE because `returns` cannot read orders.
    const validGiftLineIds = [
      ...order.orderItems.filter((item) => item.gift !== undefined).map((item) => item.id),
      ...giftSlotItems.map((item) => item.id),
    ];
    return { gifts, currency: order.currency, validGiftLineIds };
  }
}
