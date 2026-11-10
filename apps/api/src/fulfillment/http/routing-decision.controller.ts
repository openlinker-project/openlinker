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
import { Controller, Get, Inject, Param, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  resolveRoutingDecisionTtl,
  ROUTING_DECISION_REAPER_SERVICE_TOKEN,
  type IRoutingDecisionReaperService,
} from '@openlinker/core/fulfillment';

import { Roles } from '../../auth/decorators/roles.decorator';
import { RoutingDecisionStatusResponseDto } from './dto/routing-decision-status-response.dto';
import { codedHttpError } from '../../common/errors/coded-http.exception';

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
      'which the reaper closes a decision stuck `live`. Nothing here acts on the decision. ' +
      'The time limit is read from this API process (`OL_ROUTING_DECISION_TTL_MS`); the reaper runs ' +
      'in the worker and uses the worker\'s value, so the two agree only when both carry the same setting. ' +
      '`ttlSource` and `ttlWorkerMayDiffer` say so in the payload.',
  })
  @ApiResponse({ status: 200, type: RoutingDecisionStatusResponseDto })
  @ApiResponse({ status: 404, description: 'The order has no routing decision.' })
  async getRoutingDecision(
    @Param('internalOrderId') internalOrderId: string
  ): Promise<RoutingDecisionStatusResponseDto> {
    // The same resolution path the reaper uses, so the reported limit is the
    // enforced one when both processes carry the same env value. The source is
    // reported because nothing here can confirm that they do (#2660 shape).
    const ttl = resolveRoutingDecisionTtl(
      this.configService.get<string>('OL_ROUTING_DECISION_TTL_MS')
    );
    const view = await this.reaper.getStatusForOrder({
      orderId: internalOrderId,
      ttlMs: ttl.ttlMs,
      now: new Date(),
    });

    if (view === null) {
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'ROUTING_DECISION_NOT_FOUND',
        `No routing decision for order ${internalOrderId}`,
        { orderId: internalOrderId }
      );
    }
    return RoutingDecisionStatusResponseDto.fromView(view, ttl.source);
  }
}
