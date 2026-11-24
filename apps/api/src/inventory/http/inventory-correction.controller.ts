/**
 * Inventory Correction Controller (#3566)
 *
 * The operator's manual stock correction:
 *  - `GET  /inventory/:productVariantId/correction-target` - which product master
 *    a correction would write to, and the current stock (read-only).
 *  - `POST /inventory/:productVariantId/adjust` - correct the stock there.
 *
 * Literal-second-segment routes on the `inventory` prefix; none collides with
 * `/inventory/availability`, `/movements`, `/stock-view` or `/locations/*`, which
 * are single-segment or live under their own controllers.
 *
 * @module apps/api/src/inventory/http
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  INVENTORY_CORRECTION_SERVICE_TOKEN,
  type IInventoryCorrectionService,
} from '@openlinker/core/inventory';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CorrectStockDto } from './dto/correct-stock.dto';
import {
  CorrectionTargetResponseDto,
  CorrectStockResponseDto,
  toCorrectionTargetResponseDto,
  toCorrectStockResponseDto,
} from './dto/inventory-correction-response.dto';

@ApiBearerAuth()
@ApiTags('inventory')
@Controller('inventory')
export class InventoryCorrectionController {
  constructor(
    @Inject(INVENTORY_CORRECTION_SERVICE_TOKEN)
    private readonly corrections: IInventoryCorrectionService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get(':productVariantId/correction-target')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Which product master a stock correction would write to (#3566)',
    description:
      'Read-only. `kind: refused` carries the reason (`no-inventory-master`, `ambiguous-inventory-master`, ' +
      '`no-position`, `unattributed-owner`, `adapter-unresolved`) - the dialog shows it instead of a form. ' +
      '`currentQuantity` is OpenLinker\'s mirror of the owner position, which can lag the master.',
  })
  @ApiResponse({ status: 200, type: CorrectionTargetResponseDto })
  @ApiResponse({ status: 404, description: 'Unknown product variant' })
  async getCorrectionTarget(
    @Param('productVariantId') productVariantId: string
  ): Promise<CorrectionTargetResponseDto> {
    return toCorrectionTargetResponseDto(
      await this.corrections.getCorrectionTarget({ productVariantId })
    );
  }

  @Roles('admin', 'operator')
  @Post(':productVariantId/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Correct a variant\'s stock in its product master (#3566)',
    description:
      'Writes to the ONE product master that owns the stock, then mirrors the answer so marketplaces ' +
      'follow. A refusal decided before the master is reached is a 409 with a machine-readable `code` and ' +
      'nothing is written; for `confirmation-required` the body also carries `absoluteThresholdUnits` and ' +
      '`relativeThreshold`. An outcome AFTER the boundary - `applied`, `refused` by the master, `in_doubt` - ' +
      'is a 200 carrying `status`: the act is recorded in the movement ledger. `in_doubt` is never retried ' +
      'automatically and must not be retried by hand without checking the master.',
  })
  @ApiResponse({ status: 200, type: CorrectStockResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid body' })
  @ApiResponse({
    status: 409,
    description:
      'Refused before the master: no-inventory-master | ambiguous-inventory-master | no-position | ' +
      'unattributed-owner | adapter-unresolved | master-unreadable | no-change | insufficient-stock | confirmation-required | ' +
      'contended | idempotency-key-reused',
  })
  @ApiResponse({ status: 404, description: 'Unknown product variant' })
  async adjust(
    @Param('productVariantId') productVariantId: string,
    @Body() dto: CorrectStockDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<CorrectStockResponseDto> {
    const result = await this.corrections.correctStock({
      productVariantId,
      mode: dto.mode,
      quantity: dto.quantity,
      operatorReason: dto.operatorReason,
      note: dto.note ?? null,
      idempotencyKey: dto.idempotencyKey,
      confirmLargeChange: dto.confirmLargeChange,
      actorUserId: user.id,
    });
    return toCorrectStockResponseDto(result);
  }
}
