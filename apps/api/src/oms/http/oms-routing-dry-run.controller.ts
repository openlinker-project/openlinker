/**
 * OMS Routing Dry-Run Controller (#2954)
 *
 * `POST /connections/:connectionId/sourcing-rules/dry-run` - "where would this
 * order go, and what would my unsaved rules change?". It calls the router's
 * non-committing `evaluate()` only; nothing is written.
 *
 * Admin only, like the rules it tests: the page that hosts it is admin-only, and
 * the dry run exposes stock and location facts an operator does not otherwise see
 * on that page. This is a READ in effect (no state changes) but a POST in shape,
 * because the body carries an order or basket and an optional draft ruleset.
 *
 * It lives in its own controller, not on `OmsSourcingRulesController`, so the
 * rules CRUD's class-level role default cannot be inherited by accident.
 *
 * @module apps/api/src/oms/http
 */
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../auth/decorators/roles.decorator';
import {
  ROUTING_DRY_RUN_SERVICE_TOKEN,
  type DryRunSubject,
  type IRoutingDryRunService,
} from '../application/interfaces/routing-dry-run.service.interface';
import { RoutingDryRunRequestDto } from './dto/routing-dry-run-request.dto';
import { RoutingDryRunResponseDto } from './dto/routing-dry-run-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('oms')
@Controller('connections/:connectionId/sourcing-rules')
export class OmsRoutingDryRunController {
  constructor(
    @Inject(ROUTING_DRY_RUN_SERVICE_TOKEN)
    private readonly dryRuns: IRoutingDryRunService
  ) {}

  @Post('dry-run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dry-run the fulfilment router on an order or a basket',
    description:
      'Calls the non-committing evaluation only: no routing decision, fulfilment work, hold or ' +
      'idempotency key is created. Supply `draftRules` to compare the saved ruleset with an ' +
      'unsaved one. Unfulfillable-line reasons and rule labels are the router’s own words.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: RoutingDryRunResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Neither or both of orderId/basket, a non-OMS connection, an order that cannot be routed, or an invalid draft rule',
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async dryRun(
    @Param('connectionId') connectionId: string,
    @Body() dto: RoutingDryRunRequestDto
  ): Promise<RoutingDryRunResponseDto> {
    const hasOrder = dto.orderId !== undefined;
    const hasBasket = dto.basket !== undefined;
    if (hasOrder === hasBasket) {
      throw new BadRequestException('Provide exactly one of `orderId` and `basket`.');
    }

    const subject: DryRunSubject = hasBasket
      ? { basket: dto.basket! }
      : { orderId: dto.orderId! };

    const result = await this.dryRuns.dryRun(connectionId, {
      subject,
      draftRules: dto.draftRules,
    });
    return RoutingDryRunResponseDto.fromDomain(result);
  }
}
