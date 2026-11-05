/**
 * Gift Rules Controller (#3938)
 *
 * The operator surface for "add gift" rules: list, create, edit, delete,
 * reorder, resume after a cap, and a dry run on a sample order. A gift rule IS an
 * automation rule (trigger `order.ingested`, one `add-gift` step) stored in the
 * automation tables; this controller is a narrower door onto the same
 * `IAutomationRulesService`, not a second engine - which is why validation,
 * hashing and the duplicate guard are the automation ones.
 *
 * ## Why it is separate from `/automations`
 * Writes there are `@Roles('admin')` because most automations spend money. Adding
 * a gift line is reversible until the parcel is closed (gifts spec 4.5), so gift
 * rules are authored by admin AND operator, and the money acknowledgement does
 * not apply. The two doors cannot disagree about a rule: both go through the same
 * service and the same narrowers.
 *
 * @module apps/api/src/automation/http
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AUTOMATION_RULES_SERVICE_TOKEN,
  AutomationRule,
  AutomationRuleNotFoundError,
  GIFT_RULE_SERVICE_TOKEN,
  type AutomationRuleInput,
  type IAutomationRulesService,
  type IGiftRuleService,
} from '@openlinker/core/automation';
import {
  ORDER_GIFT_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderGiftService,
  type IOrderRecordService,
} from '@openlinker/core/orders';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AUTOMATION_DRAFT_RULE_ID } from '../application/automation-dry-run.service.interface';
import {
  EvaluateGiftRulesDto,
  GiftDryRunResponseDto,
  GiftRuleResponseDto,
  ReorderGiftRulesDto,
  ResumeGiftRuleDto,
  WriteGiftRuleDto,
} from './dto/gift-rule.dto';

@ApiBearerAuth()
@ApiTags('gift-rules')
@Controller('gift-rules')
export class GiftRulesController {
  constructor(
    @Inject(AUTOMATION_RULES_SERVICE_TOKEN)
    private readonly rules: IAutomationRulesService,
    @Inject(GIFT_RULE_SERVICE_TOKEN)
    private readonly gifts: IGiftRuleService,
    @Inject(ORDER_GIFT_SERVICE_TOKEN)
    private readonly orderGifts: IOrderGiftService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'List gift rules in list order',
    description:
      'List order is the order "do not combine" is defined against. Each row carries what the rule has given ' +
      '(`unitsGiven` of `effectiveCap`) and why it is paused, if it is.',
  })
  @ApiResponse({ status: 200, type: [GiftRuleResponseDto] })
  async list(): Promise<GiftRuleResponseDto[]> {
    const now = new Date();
    return (await this.gifts.listGiftRules()).map((view) => GiftRuleResponseDto.fromView(view, now));
  }

  // DECLARED BEFORE `:id` routes - Nest matches in declaration order.
  @Put('order')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Reorder the gift rules',
    description:
      'Exhaustive: the body must name EVERY gift rule exactly once. A partial list is refused with the missing ' +
      'and unknown ids reported separately, and nothing is written.',
  })
  @ApiResponse({ status: 200, type: [GiftRuleResponseDto] })
  @ApiResponse({ status: 400, description: 'The list is not exactly the set of gift rules' })
  async reorder(@Body() dto: ReorderGiftRulesDto): Promise<GiftRuleResponseDto[]> {
    await this.rules.reorderRules('order.ingested', dto.ruleIds);
    return this.list();
  }

  @Post('evaluate')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dry run - which gift rules would apply to that order, and why not',
    description:
      'Writes nothing: no gift line, no ledger row, no pause. Evaluates every saved gift rule in list order ' +
      '(plus an optional unsaved `rule` draft) and names the reason each one would not apply. The retroactivity ' +
      'floor is waived so a rule can be tested against any order; the verdict reports the waiver.',
  })
  @ApiResponse({ status: 200, type: GiftDryRunResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async evaluate(@Body() dto: EvaluateGiftRulesDto): Promise<GiftDryRunResponseDto> {
    const record = await this.orders.getOrderRecord(dto.orderId);
    if (record === null) throw new NotFoundException(`Order "${dto.orderId}" not found.`);

    let draftRule: AutomationRule | undefined;
    if (dto.rule !== undefined) {
      const validated = this.rules.validateRule(this.toRuleInput(dto.rule));
      const now = new Date();
      draftRule = new AutomationRule(
        AUTOMATION_DRAFT_RULE_ID,
        validated.name,
        validated.trigger,
        validated.triggerConfig,
        validated.conditions,
        validated.actions,
        validated.definitionHash,
        true,
        validated.effectiveFrom,
        validated.effectiveTo,
        null,
        null,
        now,
        now
      );
    }
    const preview = await this.orderGifts.previewForOrder({ record, draftRule });
    return GiftDryRunResponseDto.from(
      dto.orderId,
      preview.evaluatedAt,
      preview.evaluations,
      preview.outcomes,
      draftRule?.id ?? dto.ruleId ?? null
    );
  }

  @Get(':id')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Read one gift rule' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: GiftRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<GiftRuleResponseDto> {
    const view = (await this.gifts.listGiftRules()).find((v) => v.rule.id === id);
    if (view === undefined) throw new AutomationRuleNotFoundError(id);
    return GiftRuleResponseDto.fromView(view);
  }

  @Post()
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'Create a gift rule' })
  @ApiResponse({ status: 201, type: GiftRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Malformed gift or condition' })
  @ApiResponse({ status: 409, description: 'An identical rule already covers an overlapping window' })
  async create(@Body() dto: WriteGiftRuleDto): Promise<GiftRuleResponseDto> {
    const rule = await this.rules.createRule(this.toRuleInput(dto));
    return this.get(rule.id);
  }

  @Put(':id')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Replace a gift rule',
    description:
      'A full replace. Editing a rule never changes an open order: gifts already added stay as they were (R6). ' +
      'Its place in the list, what it has given and its pause state are kept.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: GiftRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: WriteGiftRuleDto
  ): Promise<GiftRuleResponseDto> {
    const existing = await this.rules.getRule(id);
    if (existing === null || existing.trigger !== 'order.ingested') {
      throw new AutomationRuleNotFoundError(id);
    }
    await this.rules.updateRule(id, this.toRuleInput(dto));
    return this.get(id);
  }

  @Post(':id/resume')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume a rule that stopped at its unit cap',
    description:
      'Explicit on purpose (R1): the operator decides whether the promotion goes on. Adds `additionalUnits` to the ' +
      'cap and lifts the pause. A rule paused because the gift is out of stock resumes by itself when stock returns.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: GiftRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResumeGiftRuleDto
  ): Promise<GiftRuleResponseDto> {
    const view = await this.gifts.resumeAfterCap(id, dto.additionalUnits);
    return GiftRuleResponseDto.fromView(view);
  }

  @Delete(':id')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a gift rule', description: 'Gifts already added stay; the ledger keeps its history.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    const existing = await this.rules.getRule(id);
    if (existing === null || existing.trigger !== 'order.ingested') {
      throw new AutomationRuleNotFoundError(id);
    }
    await this.rules.deleteRule(id);
  }

  private toRuleInput(dto: WriteGiftRuleDto): AutomationRuleInput {
    return {
      name: dto.name,
      trigger: 'order.ingested',
      triggerConfig: {},
      conditions: dto.conditions,
      actions: [dto.gift.toAction()],
      isActive: dto.isActive,
      effectiveFrom: new Date(dto.effectiveFrom),
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
    };
  }
}
