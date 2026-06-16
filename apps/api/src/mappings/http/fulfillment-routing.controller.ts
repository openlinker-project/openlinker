/**
 * Fulfillment Routing Controller
 *
 * HTTP REST endpoints for connection-scoped fulfillment-routing rules (#836).
 * `:connectionId` is the **source** (order-source) connection. Operators read
 * and replace the rules that *divert* a source delivery method away from the
 * default PrestaShop-fulfilled path to an OL-managed carrier or a source-brokered
 * processor, and list the compatible processor candidates for the config UI.
 * Routing domain exceptions are mapped to HTTP at this boundary. Admin + JWT.
 *
 * @module apps/api/src/mappings/http
 */

import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  type IFulfillmentRoutingService,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IncompatibleProcessorException,
  DuplicateRoutingRuleException,
} from '@openlinker/core/mappings';
import { UpsertRoutingRulesDto } from './dto/upsert-routing-rules.dto';
import { RoutingRuleResponseDto } from './dto/routing-rule-response.dto';
import { CandidateProcessorResponseDto } from './dto/candidate-processor-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('mappings')
@Controller('connections/:connectionId/routing-rules')
export class FulfillmentRoutingController {
  constructor(
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN)
    private readonly routing: IFulfillmentRoutingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get fulfillment-routing rules for a source connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [RoutingRuleResponseDto] })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getRules(@Param('connectionId') connectionId: string): Promise<RoutingRuleResponseDto[]> {
    try {
      const rules = await this.routing.getRules(connectionId);
      return rules.map((rule) => RoutingRuleResponseDto.fromDomain(rule));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Get('candidates')
  @ApiOperation({
    summary: 'List processors a source connection may route its delivery methods to',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [CandidateProcessorResponseDto] })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async getCandidates(
    @Param('connectionId') connectionId: string,
  ): Promise<CandidateProcessorResponseDto[]> {
    try {
      const candidates = await this.routing.getCandidateProcessors(connectionId);
      return candidates.map((candidate) => CandidateProcessorResponseDto.fromDomain(candidate));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace all fulfillment-routing rules for a source connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [RoutingRuleResponseDto] })
  @ApiResponse({ status: 400, description: 'Incompatible processor or duplicate method' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async replaceRules(
    @Param('connectionId') connectionId: string,
    @Body() dto: UpsertRoutingRulesDto,
  ): Promise<RoutingRuleResponseDto[]> {
    try {
      const rules = await this.routing.replaceRules(connectionId, dto.items);
      return rules.map((rule) => RoutingRuleResponseDto.fromDomain(rule));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  /**
   * Map the routing-specific domain exceptions to HTTP. Connection-lifecycle
   * exceptions (`ConnectionNotFoundException` → 404, `ConnectionDisabledException`
   * → 409) are intentionally NOT mapped here — they propagate to the global
   * `ConnectionExceptionFilter` (#1087) so the connection-status contract stays
   * consistent across every endpoint. Only the genuinely-local routing errors
   * map to 400; anything else falls through to Nest's default handling.
   */
  private toHttpException(error: unknown): Error {
    if (
      error instanceof IncompatibleProcessorException ||
      error instanceof DuplicateRoutingRuleException
    ) {
      return new BadRequestException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
