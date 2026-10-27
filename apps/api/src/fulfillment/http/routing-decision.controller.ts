/**
 * Routing Decision Controller (#2731)
 *
 * `GET /orders/:internalOrderId/routing-decision` — the read-only view of an
 * order's latest routing decision, including one stranded `live` after an
 * in-doubt router call. It backs #3557's stuck-decision panel.
 *
 * Read only, by design (D4): there is no route that forces, checks or abandons a
 * decision. A stranded decision is closed by the worker's reaper alone.
 *
 * Lives in the fulfilment API module rather than on `OrdersController` because
 * the decision belongs to the `fulfillment` context, reached here through
 * `IRoutingDecisionReaperService` and never the decision repository port.
 *
 * @module apps/api/src/fulfillment/http
 */
import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  resolveRoutingDecisionTtlMs,
  ROUTING_DECISION_REAPER_SERVICE_TOKEN,
  type IRoutingDecisionReaperService,
} from '@openlinker/core/fulfillment';

import { Roles } from '../../auth/decorators/roles.decorator';
import { RoutingDecisionStatusResponseDto } from './dto/routing-decision-status-response.dto';

@ApiBearerAuth()
@ApiTags('fulfillment')
@Controller('orders')
export class RoutingDecisionController {
  constructor(
    @Inject(ROUTING_DECISION_REAPER_SERVICE_TOKEN)
    private readonly reaper: IRoutingDecisionReaperService,
    private readonly configService: ConfigService
  ) {}

  @Get(':internalOrderId/routing-decision')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: "Read an order's latest routing decision",
    description:
      'Read-only. Reports the state, the router it waits on, its age and the time limit after ' +
      'which the reaper closes a decision stuck `live`. Nothing here acts on the decision.',
  })
  @ApiResponse({ status: 200, type: RoutingDecisionStatusResponseDto })
  @ApiResponse({ status: 404, description: 'The order has no routing decision.' })
  async getRoutingDecision(
    @Param('internalOrderId') internalOrderId: string
  ): Promise<RoutingDecisionStatusResponseDto> {
    const view = await this.reaper.getStatusForOrder({
      orderId: internalOrderId,
      // The same resolution path the reaper uses, so the reported limit is the
      // enforced one — provided both processes carry the same env value.
      ttlMs: resolveRoutingDecisionTtlMs(
        this.configService.get<string>('OL_ROUTING_DECISION_TTL_MS')
      ),
      now: new Date(),
    });

    if (view === null) {
      throw new NotFoundException(`No routing decision for order ${internalOrderId}`);
    }
    return RoutingDecisionStatusResponseDto.fromView(view);
  }
}
