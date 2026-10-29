/**
 * Order Line Costs Controller (#3588, D27)
 *
 * Cost at order time and margin per line of one order. `packer` is deliberately
 * excluded (and so is `@AnyRole()`): cost must never reach the bench role.
 *
 * @module apps/api/src/orders/http
 */
import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  type IAnalyticsDisplaySettingsService,
} from '@openlinker/core/analytics';
import { ORDER_LINE_COST_SERVICE_TOKEN, type IOrderLineCostService } from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import { OrderLineCostsResponseDto } from './dto/order-line-costs-response.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/:internalOrderId/line-costs')
export class OrderLineCostsController {
  constructor(
    @Inject(ORDER_LINE_COST_SERVICE_TOKEN)
    private readonly service: IOrderLineCostService,
    @Inject(ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN)
    private readonly displaySettings: IAnalyticsDisplaySettingsService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({ summary: 'Cost at order time and margin per line of one order.' })
  @ApiResponse({ status: 200, type: OrderLineCostsResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async getLineCosts(
    @Param('internalOrderId') internalOrderId: string
  ): Promise<OrderLineCostsResponseDto> {
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();
    const result = await this.service.getLineCosts(
      internalOrderId,
      includeBackfilledTaxRatesInNetSales
    );
    if (!result) {
      throw new NotFoundException(`Order not found: ${internalOrderId}`);
    }
    return result;
  }
}
