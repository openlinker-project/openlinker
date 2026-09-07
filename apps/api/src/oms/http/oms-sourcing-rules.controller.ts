/**
 * OMS Sourcing Rules Controller (#2953)
 *
 * The operator-facing CRUD for the OL fulfilment router's ordered ruleset
 * (`oms_routing_rules`). Before this, `ROUTING_RULE_SOURCE_TOKEN` had exactly
 * one non-test consumer — the router binding — so an operator could author a
 * ruleset only by inserting rows into the database by hand, and Wave 3a's exit
 * criterion (#2412, "authors an ordered filter/sort list") was unreachable.
 *
 * ## The prefix is `sourcing-rules`, and that is load-bearing
 *
 * `apps/api/src/mappings/http/fulfillment-routing.controller.ts` already mounts
 * `connections/:connectionId/routing-rules` — the ADR-012 **dispatch** surface
 * (#836/#832), answering *"which processor or carrier ships this?"*. This one
 * answers *"which location and holder SOURCES it?"*. The two are deliberately
 * kept apart (`fulfillment-router.port.ts` forbids wiring one into the other),
 * and sharing a URL namespace would wire them together at the layer an operator
 * actually sees: `GET /connections/:id/routing-rules` would be declared twice,
 * NestJS registers both, and the first-registered wins SILENTLY — so depending
 * on module order one of the two surfaces becomes unreachable with no boot
 * error and nothing failing (`route-authorization-coverage.spec.ts` checks
 * decorators, not path uniqueness).
 *
 * ## Ordering is an explicit part of the write surface
 *
 * `position` is REQUIRED on create and `PUT /order` renumbers to a dense `1..N`
 * — the issue's own requirement that order be expressed rather than derived from
 * insertion time. The reorder is EXHAUSTIVE: a body naming a subset is refused
 * and writes nothing, because a partial reorder silently leaves the un-named
 * rules at stale positions.
 *
 * Auth: class-level `@Roles('admin')` on top of the global `JwtAuthGuard`. This
 * is a configuration-authoring surface end to end, so the reads are admin too —
 * the `SalesDocumentRulesController` shape.
 *
 * @module apps/api/src/oms/http
 */
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  DuplicateLiveRoutingRuleError,
  RoutingRuleNotFoundError,
  RoutingRuleReorderMismatchError,
} from '@openlinker/oms';

import { Roles } from '../../auth/decorators/roles.decorator';
import {
  SOURCING_RULE_ADMIN_SERVICE_TOKEN,
  type ISourcingRuleAdminService,
} from '../application/interfaces/sourcing-rule-admin.service.interface';
import { CreateSourcingRuleDto } from './dto/create-sourcing-rule.dto';
import { ListSourcingRulesQueryDto } from './dto/list-sourcing-rules-query.dto';
import { ReorderSourcingRulesDto } from './dto/reorder-sourcing-rules.dto';
import { SourcingRuleResponseDto } from './dto/sourcing-rule-response.dto';
import { UpdateSourcingRuleDto } from './dto/update-sourcing-rule.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('oms')
@Controller('connections/:connectionId/sourcing-rules')
export class OmsSourcingRulesController {
  constructor(
    @Inject(SOURCING_RULE_ADMIN_SERVICE_TOKEN)
    private readonly rules: ISourcingRuleAdminService
  ) {}

  @Get()
  @ApiOperation({
    summary: "List the OMS connection's fulfilment sourcing rules, in evaluation order",
    description:
      'Ordered by position then id — the same tie-break the router applies, so the listed ' +
      'order IS the order these rules are evaluated in. A rule the router cannot understand ' +
      'is listed with `recognised: false` rather than hidden: it is persisted, invisible to ' +
      'the router, and can only be removed by DELETE.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [SourcingRuleResponseDto] })
  @ApiResponse({ status: 400, description: 'Connection is not an OpenLinker OMS connection' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async list(
    @Param('connectionId') connectionId: string,
    @Query() query: ListSourcingRulesQueryDto
  ): Promise<SourcingRuleResponseDto[]> {
    try {
      const rules = await this.rules.listRules(connectionId, query.includeSuperseded ?? false);
      return rules.map((rule) => SourcingRuleResponseDto.fromDomain(rule));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a fulfilment sourcing rule',
    description:
      '`position` is required: ordering is part of the contract and is stated, never derived ' +
      'from insertion time. A kind/name pair the router cannot evaluate is refused (400) ' +
      'rather than persisted as a rule that saves and never fires.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 201, type: SourcingRuleResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Not an OMS connection, kind/name mismatch, priorityLocationIds on a non-priority rule, ' +
      'an unknown location id, or an effective window that closes before it opens',
  })
  @ApiResponse({ status: 409, description: 'A live rule already claims this (kind, name)' })
  async create(
    @Param('connectionId') connectionId: string,
    @Body() dto: CreateSourcingRuleDto
  ): Promise<SourcingRuleResponseDto> {
    try {
      const rule = await this.rules.createRule(connectionId, {
        position: dto.position,
        kind: dto.kind,
        name: dto.name,
        afterAction: dto.afterAction,
        priorityLocationIds: dto.priorityLocationIds ?? [],
        effectiveFrom: this.toDate(dto.effectiveFrom),
        effectiveTo: this.toDate(dto.effectiveTo),
      });
      return SourcingRuleResponseDto.fromDomain(rule);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Put('order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reorder every non-retired sourcing rule on the connection',
    description:
      'EXHAUSTIVE: the body must name every non-retired rule exactly once. A subset is ' +
      'refused (409) and nothing is written — a partial reorder would leave the un-named ' +
      'rules at stale positions while looking like it worked. Rules are renumbered 1..N.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [SourcingRuleResponseDto] })
  @ApiResponse({ status: 409, description: 'The list did not name exactly the active rules' })
  async reorder(
    @Param('connectionId') connectionId: string,
    @Body() dto: ReorderSourcingRulesDto
  ): Promise<SourcingRuleResponseDto[]> {
    try {
      const rules = await this.rules.reorderRules(connectionId, dto.ruleIds);
      return rules.map((rule) => SourcingRuleResponseDto.fromDomain(rule));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Get(':ruleId')
  @ApiOperation({ summary: 'Get one fulfilment sourcing rule' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiParam({ name: 'ruleId', type: String })
  @ApiResponse({ status: 200, type: SourcingRuleResponseDto })
  @ApiResponse({
    status: 404,
    description:
      'No such rule on this connection. A rule belonging to a DIFFERENT connection also ' +
      'answers 404, never 403 — a 403 would confirm that the id names a real rule elsewhere.',
  })
  async get(
    @Param('connectionId') connectionId: string,
    @Param('ruleId') ruleId: string
  ): Promise<SourcingRuleResponseDto> {
    try {
      return SourcingRuleResponseDto.fromDomain(await this.rules.getRule(connectionId, ruleId));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Patch(':ruleId')
  @ApiOperation({
    summary: 'Edit a fulfilment sourcing rule',
    description:
      '`kind` is not patchable — it is half the rule\'s identity, so changing it is ' +
      'delete-and-recreate. Setting `effectiveTo` to a past instant RETIRES the rule while ' +
      'keeping it for history; that is the non-destructive alternative to DELETE.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiParam({ name: 'ruleId', type: String })
  @ApiResponse({ status: 200, type: SourcingRuleResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'The resulting rule would not be evaluable. Three cases worth knowing: a rule already ' +
      'stored as `recognised: false` cannot be patched at all (delete and recreate it); ' +
      'moving `name` off `priority` while the row still holds `priorityLocationIds` is ' +
      'refused unless the same patch sends `priorityLocationIds: []`, so dropping the list ' +
      'is always acknowledged rather than silent; and the effective window is validated ' +
      'against the MERGED row, so a lone `effectiveTo` is checked against the stored ' +
      '`effectiveFrom`.',
  })
  @ApiResponse({ status: 404, description: 'No such rule on this connection' })
  @ApiResponse({ status: 409, description: 'Reviving this rule collides with a live sibling' })
  async update(
    @Param('connectionId') connectionId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateSourcingRuleDto
  ): Promise<SourcingRuleResponseDto> {
    try {
      const rule = await this.rules.updateRule(connectionId, ruleId, {
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.afterAction !== undefined ? { afterAction: dto.afterAction } : {}),
        ...(dto.priorityLocationIds !== undefined
          ? { priorityLocationIds: dto.priorityLocationIds }
          : {}),
        ...(dto.effectiveFrom !== undefined
          ? { effectiveFrom: this.toDate(dto.effectiveFrom) }
          : {}),
        ...(dto.effectiveTo !== undefined ? { effectiveTo: this.toDate(dto.effectiveTo) } : {}),
      });
      return SourcingRuleResponseDto.fromDomain(rule);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Delete(':ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a fulfilment sourcing rule',
    description:
      'A HARD delete, including its history. To retire a rule while keeping the record, ' +
      'PATCH `effectiveTo` instead — the duplicate-detection index is partial precisely so a ' +
      'retired rule can coexist with its replacement. Deleting leaves a gap in the position ' +
      'sequence; PUT /order closes it.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiParam({ name: 'ruleId', type: String })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'No such rule on this connection' })
  async remove(
    @Param('connectionId') connectionId: string,
    @Param('ruleId') ruleId: string
  ): Promise<void> {
    try {
      await this.rules.deleteRule(connectionId, ruleId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private toDate(value: string | null | undefined): Date | null {
    return value === null || value === undefined ? null : new Date(value);
  }

  /**
   * Maps `@openlinker/oms` domain errors to statuses. Deliberately a local
   * mapper rather than a global filter (the `SalesDocumentRulesController`
   * shape): these errors have exactly one HTTP consumer, so a global filter
   * would widen their blast radius for no benefit.
   *
   * `ConnectionNotFoundException` is NOT handled here — the global
   * `ConnectionExceptionFilter` already maps it — and neither is
   * `BadRequestException`, which the service raises directly and which falls
   * through unchanged.
   */
  private toHttpException(error: unknown): Error {
    if (error instanceof RoutingRuleNotFoundError) {
      return new NotFoundException(error.message);
    }
    if (error instanceof DuplicateLiveRoutingRuleError) {
      return new ConflictException(error.message);
    }
    if (error instanceof RoutingRuleReorderMismatchError) {
      // Both id sets are emitted as FIELDS, not folded into the message: they
      // are what an operator's client needs to correct the list, and a client
      // parsing them out of prose breaks on the first reword.
      return new ConflictException({
        message: error.message,
        missingRuleIds: error.missingRuleIds,
        unknownRuleIds: error.unknownRuleIds,
      });
    }
    // Everything else passes through unchanged — `BadRequestException` from the
    // service, `ConnectionNotFoundException` for the global filter to map. The
    // non-Error arm keeps the return type honest rather than re-throwing a
    // value `throw` cannot describe; it is the `FulfillmentRoutingController`
    // shape verbatim.
    return error instanceof Error ? error : new Error(String(error));
  }
}
