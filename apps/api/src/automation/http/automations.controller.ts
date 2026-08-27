/**
 * Automations Controller (#2363, Wave-2 spec §5)
 *
 * The operator surface for automation v1: the trigger index, per-trigger rule
 * CRUD, the closed vocabulary, the §5.6(a) dry run, and the per-rule fired log.
 *
 * ## Authorization
 *
 * `JwtAuthGuard` is a global `APP_GUARD` (`auth.module.ts`), so no `@UseGuards`
 * appears here; `@Roles` is the only per-route decision.
 *
 * **Writes are `admin`; every read and the dry run are `admin` + `operator`.**
 * Arming an automation is a STANDING grant of authority to act on the operator's
 * behalf, unbounded in count — one rule can buy a thousand labels. That is an
 * administrative act, and it is the same class of decision as
 * `SalesDocumentRulesController`, which is `@Roles('admin')` for the rules that
 * pick a fiscal document. The role is uniform across all four writes rather than
 * gated on whether a particular rule spends money, because a rule's actions are
 * editable: a non-admin who could create a `send-email` rule could then replace
 * it with a `dispatch-shipment` rule, and a permission a later edit can escalate
 * is not a permission. The reads and the dry run stay open to operators, since
 * diagnosing why a rule did not fire is exactly the operational work §5.6 exists
 * to support — and the dry run writes nothing.
 *
 * ## Two deliberate deviations from the issue text, both recorded
 *
 * **`PUT`, not `PATCH`.** `IAutomationRulesService.updateRule` takes a COMPLETE
 * input and re-validates and re-hashes all of it, so it is a replace. Calling it
 * `PATCH` would tell a client it may send a partial body, and a partial body
 * nulls out `conditions` / `actions` through the narrowers. Matches
 * `SalesDocumentRulesController`'s `PUT /country-defaults`, whose own inline
 * comment reasons identically.
 *
 * **`GET /automations` requires `trigger`.** `IAutomationRulesService` exposes
 * `listRulesByTrigger` and no list-all, and `IDX_automation_rules_trigger_active`
 * is keyed on the trigger — so an unfiltered list would mean either a new
 * unindexed full-table read or a 500. `GET /automations/summary` over the
 * already-shipped `countRulesByTrigger()` gives the index page instead, which is
 * what §5.5 divergence 1 describes ("trigger is the scope column and the index
 * axis") and what that repository method's own docblock names as its purpose.
 *
 * Domain refusals are mapped by the global `AutomationExceptionFilter`, not
 * caught here.
 *
 * @module apps/api/src/automation/http
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AUTOMATION_RULES_SERVICE_TOKEN,
  AUTOMATION_RUNS_READ_SERVICE_TOKEN,
  AutomationRuleNotFoundError,
  AutomationRunOutcomeValues,
  AutomationRunSubjectKindValues,
  AutomationTriggerValues,
  isAutomationActionKind,
  isAutomationRunOutcome,
  isAutomationRunSubjectKind,
  isAutomationTrigger,
  isIrreversibleAction,
  isLegalAutomationPair,
  type AutomationMoneyAckInput,
  type AutomationRunFilters,
  type AutomationRuleInput,
  type AutomationTrigger,
  type IAutomationRulesService,
  type IAutomationRunsReadService,
} from '@openlinker/core/automation';

import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  AUTOMATION_DRY_RUN_SERVICE_TOKEN,
  type IAutomationDryRunService,
} from '../application/automation-dry-run.tokens';
import { AUTOMATION_RETRY_SERVICE_TOKEN } from '../application/automation-retry.tokens';
import { IAutomationRetryService } from '../application/automation-retry.service.interface';
import type { AutomationRuleDefinitionDto } from './dto/automation-rule.dto';
import { WriteAutomationRuleDto } from './dto/automation-rule.dto';
import { EvaluateAutomationDto } from './dto/evaluate-automation.dto';
import {
  AutomationAttentionCountDto,
  AutomationRuleResponseDto,
  AutomationRunLogResponseDto,
  AutomationRunResponseDto,
  AutomationTriggerSummaryDto,
} from './dto/automation-response.dto';
import { AutomationDryRunResponseDto } from './dto/automation-dry-run-response.dto';
import { AutomationVocabularyResponseDto } from './dto/automation-vocabulary-response.dto';

/** A bare calendar day, with no time part — what a `<input type="date">` emits. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse an ISO instant from a query param.
 *
 * Returns `null` for anything unparseable — there is no `is*` guard for a date,
 * so without this `from=banana` has no handler at all: `new Date('banana')` is
 * an `Invalid Date` that either throws at the query layer or silently matches
 * nothing. Both would break the rule that an unrecognised NARROWING filter is
 * ignored rather than thrown.
 *
 * **A date-only UPPER bound is widened to the end of that day.** Both bounds are
 * documented inclusive, but `new Date('2026-08-20')` is midnight UTC — so a
 * `LessThanOrEqual` against it matches only runs fired at exactly 00:00:00.000
 * and excludes the entire day the operator picked. On the commonest query of all
 * (one day, `from` === `to`) that returns an empty list for a day full of
 * activity, and the operator reads "no runs match" as "nothing ran". The
 * operator chose a DAY; the control cannot express an instant.
 */
function parseIsoDate(value: string | undefined, bound: 'lower' | 'upper'): Date | null {
  if (value === undefined || value.length === 0) return null;
  const parsed = new Date(
    bound === 'upper' && DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

@ApiBearerAuth()
@ApiTags('automations')
@Controller('automations')
export class AutomationsController {
  constructor(
    @Inject(AUTOMATION_RULES_SERVICE_TOKEN)
    private readonly rules: IAutomationRulesService,
    @Inject(AUTOMATION_RUNS_READ_SERVICE_TOKEN)
    private readonly runs: IAutomationRunsReadService,
    @Inject(AUTOMATION_DRY_RUN_SERVICE_TOKEN)
    private readonly dryRun: IAutomationDryRunService,
    @Inject(AUTOMATION_RETRY_SERVICE_TOKEN)
    private readonly retryService: IAutomationRetryService
  ) {}

  @Get('vocabulary')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'The closed trigger / action / condition vocabulary and the §5.4 legality matrix',
    description:
      'The only source of these values — nothing client-side should hard-code a trigger, an action or a legal ' +
      'pair. `actions[].availability` reports what can ACTUALLY run in this build: five of the six actions ' +
      'cannot, and a composer that offers them as ready lets an operator arm a rule whose only signal is a ' +
      'failed run.',
  })
  @ApiResponse({ status: 200, type: AutomationVocabularyResponseDto })
  getVocabulary(): AutomationVocabularyResponseDto {
    return AutomationVocabularyResponseDto.build();
  }

  @Get('summary')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Rule counts per trigger — the automations index page',
    description:
      'The §5.5 divergence-1 trigger index. Rules are scoped and indexed BY TRIGGER, so the index is a ' +
      'per-trigger drill-down rather than a read of the whole table.',
  })
  @ApiResponse({ status: 200, type: [AutomationTriggerSummaryDto] })
  async getSummary(): Promise<AutomationTriggerSummaryDto[]> {
    const counts = await this.rules.countRulesByTrigger();
    // Every trigger, including the ones with no rules — a trigger absent from the
    // index reads as "not supported" rather than "nothing configured", and the
    // second is the one an operator can act on.
    return AutomationTriggerValues.map((trigger) => {
      const dto = new AutomationTriggerSummaryDto();
      dto.trigger = trigger;
      dto.ruleCount = counts.get(trigger) ?? 0;
      return dto;
    });
  }

  @Get('attention-count')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'How many firings need an operator\'s attention (#2387)',
    description:
      'DERIVED from `automation_runs`, sharing one SQL predicate with the `attentionOnly` filter — ' +
      'so this number and the rows behind it can never disagree. Zero is the healthy answer: only ' +
      'a FAILED firing counts, never a rule that ran and found nothing to do.',
  })
  @ApiResponse({ status: 200, type: AutomationAttentionCountDto })
  async getAttentionCount(): Promise<AutomationAttentionCountDto> {
    const dto = new AutomationAttentionCountDto();
    dto.count = await this.runs.countAttention();
    return dto;
  }

  @Get()
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'List the rules on one trigger, active and inactive' })
  @ApiQuery({ name: 'trigger', required: true, enum: AutomationTriggerValues })
  @ApiResponse({ status: 200, type: [AutomationRuleResponseDto] })
  @ApiResponse({ status: 400, description: 'Missing or unrecognised trigger' })
  async listRules(@Query('trigger') trigger: string): Promise<AutomationRuleResponseDto[]> {
    const rules = await this.rules.listRulesByTrigger(this.assertTrigger(trigger));
    return rules.map((rule) => AutomationRuleResponseDto.fromDomain(rule));
  }

  // DECLARED BEFORE `@Get(':id')` — Nest matches in declaration order, so a
  // dynamic `:id` above this would swallow `/automations/runs` entirely. Nothing
  // in the unit suite can catch a reordering: the spec calls these handlers
  // directly and never goes through the router.
  @Get('runs')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Recent automation firings, newest first — optionally scoped to one subject',
    description:
      'ONE read serves both the activity list and an order\'s timeline: pass `subjectKind` + ' +
      '`subjectId` to scope it. That is deliberate — the timeline, the activity list, the per-rule ' +
      'log and the attention state are four READINGS of one `automation_runs` row, and two ' +
      'endpoints over the same rows could disagree about them. Check `recordingAvailable`: while ' +
      'it is false an empty list says nothing about whether anything fired.',
  })
  @ApiQuery({ name: 'subjectKind', required: false, enum: AutomationRunSubjectKindValues })
  @ApiQuery({ name: 'subjectId', required: false, type: String })
  @ApiQuery({ name: 'orderId', required: false, type: String, description: 'Shorthand for subjectKind=order.' })
  @ApiQuery({ name: 'ruleId', required: false, type: String })
  @ApiQuery({ name: 'trigger', required: false, enum: AutomationTriggerValues })
  @ApiQuery({ name: 'outcome', required: false, enum: AutomationRunOutcomeValues })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'ISO instant, inclusive.' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'ISO instant, inclusive.' })
  @ApiQuery({
    name: 'attentionOnly',
    required: false,
    type: Boolean,
    description:
      'Narrow to firings that need attention (#2387) — failed, not dismissed, not superseded by a ' +
      'successful retry. Shares one SQL predicate with the attention count, so the count can never ' +
      'disagree with these rows.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, type: AutomationRunLogResponseDto })
  @ApiResponse({ status: 400, description: 'Unrecognised subjectKind, or subjectId without it' })
  async listRunFeed(
    @Query('subjectKind') subjectKind?: string,
    @Query('subjectId') subjectId?: string,
    @Query('orderId') orderId?: string,
    @Query('ruleId') ruleId?: string,
    @Query('trigger') trigger?: string,
    @Query('outcome') outcome?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('attentionOnly') attentionOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AutomationRunLogResponseDto> {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    const parsedOffset = offset === undefined ? undefined : Number(offset);

    // `orderId` is the PUBLIC param name (#2386) — a shared link should use the
    // operator's vocabulary, not the storage pair. It resolves to the subject
    // scope here, at the read boundary.
    const scopedSubjectId =
      orderId !== undefined && orderId.length > 0 ? orderId : subjectId;
    const scopedSubjectKind =
      orderId !== undefined && orderId.length > 0 ? 'order' : subjectKind;

    // ── The asymmetry, and why it is not an inconsistency ──────────────────
    //
    // A SUBJECT SCOPE that cannot be honoured THROWS: the result would be rows
    // for OTHER subjects, which an operator cannot detect by looking.
    //
    // A NARROWING filter that cannot be honoured is IGNORED (below): the result
    // is merely WIDER than asked — visible, and recoverable by fixing the URL.
    if (scopedSubjectId !== undefined && scopedSubjectId.length > 0) {
      if (!isAutomationRunSubjectKind(scopedSubjectKind)) {
        throw new BadRequestException(
          `Filtering by subject needs a recognised "subjectKind". Expected one of: ` +
            `${AutomationRunSubjectKindValues.join(', ')}.`,
        );
      }
    }

    const filters: AutomationRunFilters = {
      ...(ruleId !== undefined && ruleId.length > 0 ? { ruleId } : {}),
      ...(isAutomationTrigger(trigger) ? { trigger } : {}),
      ...(isAutomationRunOutcome(outcome) ? { outcome } : {}),
      ...(scopedSubjectId !== undefined &&
      scopedSubjectId.length > 0 &&
      isAutomationRunSubjectKind(scopedSubjectKind)
        ? { subjectKind: scopedSubjectKind, subjectId: scopedSubjectId }
        : {}),
      ...(parseIsoDate(from, 'lower') === null
        ? {}
        : { from: parseIsoDate(from, 'lower') as Date }),
      ...(parseIsoDate(to, 'upper') === null ? {} : { to: parseIsoDate(to, 'upper') as Date }),
      // Only the literal string `true` narrows. Anything else — including
      // `false`, `0` and a typo — is treated as absent, per the narrowing-filter
      // rule: an unrecognised value must WIDEN the result, never empty it.
      ...(attentionOnly === 'true' ? { attentionOnly: true } : {}),
    };

    return AutomationRunLogResponseDto.fromDomain(
      await this.runs.listRecent(filters, parsedLimit, parsedOffset),
    );
  }

  @Post('runs/:runId/retry')
  // 200, not Nest's default 201: neither route creates a resource the CLIENT
  // addresses. Both return an updated view of an EXISTING run — the retry's new
  // row is an internal consequence, and it carries no Location of its own.
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({
    summary: 'Re-run the rule of a failed firing against that firing\'s own order',
    description:
      'Runs the WHOLE rule again, in order, and writes a NEW run row linked back by ' +
      '`retryOfRunId` — which is what clears the AF-X attention state without a later, unrelated ' +
      'firing of the same rule clearing it. Conditions are NOT re-evaluated (the rule already ' +
      'matched; re-evaluating would re-apply the retroactivity floor and refuse every retry of an ' +
      'older firing). Refusals mirror `retryable` / `retryRefusalReason` on the run, so a client ' +
      'shows a disabled action with its reason rather than discovering the 400. ' +
      'NOTE: this dispatches INLINE, so the request blocks for the rule\'s steps.',
  })
  @ApiParam({ name: 'runId', type: String })
  @ApiResponse({ status: 200, type: AutomationRunResponseDto, description: 'The ORIGINAL run, re-projected.' })
  @ApiResponse({ status: 400, description: 'Not retryable — body carries `reason`.' })
  @ApiResponse({ status: 404, description: 'Run, or its order, not found' })
  async retryRun(@Param('runId') runId: string): Promise<AutomationRunResponseDto> {
    return AutomationRunResponseDto.fromDomain(await this.retryService.retry({ runId }));
  }

  @Post('runs/:runId/dismiss')
  // 200, not Nest's default 201: neither route creates a resource the CLIENT
  // addresses. Both return an updated view of an EXISTING run — the retry's new
  // row is an internal consequence, and it carries no Location of its own.
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({
    summary: 'Record that an operator handled a failed firing themselves',
    description:
      'Clears the AF-X attention state ONLY. The run stays `failed` and its timeline entries stay ' +
      'exactly as they are: this records that a HUMAN dealt with it, never that the operation ' +
      'succeeded — OpenLinker must not claim it did something a person did outside it. ' +
      'Re-dismissing is a no-op that returns the row unchanged.',
  })
  @ApiParam({ name: 'runId', type: String })
  @ApiResponse({ status: 200, type: AutomationRunResponseDto })
  @ApiResponse({ status: 404, description: 'Run not found' })
  async dismissRun(
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AutomationRunResponseDto> {
    const run = await this.runs.dismiss(runId, user.id, new Date());
    if (run === null) {
      throw new NotFoundException(`Automation run "${runId}" not found.`);
    }
    return AutomationRunResponseDto.fromDomain(run);
  }

  @Get('runs/:runId')
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'One firing' })
  @ApiParam({ name: 'runId', type: String })
  @ApiResponse({ status: 200, type: AutomationRunResponseDto })
  @ApiResponse({ status: 404, description: 'Run not found' })
  async getRun(@Param('runId') runId: string): Promise<AutomationRunResponseDto> {
    const run = await this.runs.getRunById(runId);
    if (run === null) {
      throw new NotFoundException(`Automation run "${runId}" not found.`);
    }
    return AutomationRunResponseDto.fromDomain(run);
  }

  @Get(':id')
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'Read one rule' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: AutomationRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async getRule(@Param('id') id: string): Promise<AutomationRuleResponseDto> {
    const rule = await this.rules.getRule(id);
    if (rule === null) // The DOMAIN error, not a `NotFoundException`: it goes through the same
    // `AutomationExceptionFilter` as every write and carries the same `ruleId`
    // field, so a read and a write cannot answer differently about one missing row.
    throw new AutomationRuleNotFoundError(id);
    return AutomationRuleResponseDto.fromDomain(rule);
  }

  @Get(':id/runs')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: "This rule's most recent firings",
    description:
      'One source: the `automation_runs` record, which #2385 writes for EVERY firing including those whose ' +
      'step dispatched a job — a step that did carries `syncJobId`, so the job detail stays one link away. ' +
      'Check `recordingAvailable`: while it is false the log stays empty even when rules fire.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: AutomationRunLogResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async listRunsForRule(@Param('id') id: string): Promise<AutomationRunLogResponseDto> {
    // The rule is read first so an unknown id is a 404 rather than an empty log —
    // "this rule never fired" and "there is no such rule" are different answers.
    const rule = await this.rules.getRule(id);
    if (rule === null) // The DOMAIN error, not a `NotFoundException`: it goes through the same
    // `AutomationExceptionFilter` as every write and carries the same `ruleId`
    // field, so a read and a write cannot answer differently about one missing row.
    throw new AutomationRuleNotFoundError(id);
    return AutomationRunLogResponseDto.fromDomain(await this.runs.listRecentByRule(id));
  }

  @Post('evaluate')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dry run — would this rule have fired for that order?',
    description:
      'Commits nothing and dispatches nothing. Accepts a saved `ruleId` or an unsaved `rule` draft (the ' +
      'point of §5.6a: test a money rule BEFORE arming it). Returns a verdict for every rule scoped to the ' +
      'trigger, so a two-money-rules collision is visible; each verdict carries the per-condition trace, ' +
      '`wouldFire`, and — where the at-most-one gate refused it — which rules collided and on which actions. ' +
      'The retroactivity floor is waived on this path and the waiver is reported per verdict.',
  })
  @ApiResponse({ status: 200, type: AutomationDryRunResponseDto })
  @ApiResponse({ status: 400, description: 'The draft is not a valid rule (same refusals as a save)' })
  @ApiResponse({ status: 404, description: 'Order or rule not found' })
  async evaluate(@Body() dto: EvaluateAutomationDto): Promise<AutomationDryRunResponseDto> {
    const result = await this.dryRun.evaluate({
      orderId: dto.orderId,
      ruleId: dto.ruleId,
      draft: dto.rule ? this.toRuleInput(dto.rule) : undefined,
    });
    return AutomationDryRunResponseDto.fromDomain(result);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a rule' })
  @ApiResponse({ status: 201, type: AutomationRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Illegal pair, illegal condition field, malformed step, or a missing money acknowledgement' })
  @ApiResponse({ status: 409, description: 'An identical definition already covers an overlapping window' })
  async createRule(
    @Body() dto: WriteAutomationRuleDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AutomationRuleResponseDto> {
    const input = this.toRuleInput(dto);
    const rule = await this.rules.createRule(input, this.resolveMoneyAck(dto, input, user));
    return AutomationRuleResponseDto.fromDomain(rule);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Replace a rule',
    description:
      'A full replace, not a patch — every field is re-validated and re-hashed. **Changing what the rule DOES ' +
      '(its trigger, threshold, conditions or actions) clears the money acknowledgement**, because the ' +
      'acknowledgement is evidence about that definition; a rename, an arm/disarm or a moved effective window ' +
      'keeps it.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: AutomationRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Illegal pair, malformed step, or a missing money acknowledgement' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 409, description: 'An identical definition already covers an overlapping window' })
  async replaceRule(
    @Param('id') id: string,
    @Body() dto: WriteAutomationRuleDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AutomationRuleResponseDto> {
    const input = this.toRuleInput(dto);
    const rule = await this.rules.updateRule(id, input, this.resolveMoneyAck(dto, input, user));
    return AutomationRuleResponseDto.fromDomain(rule);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a rule' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async deleteRule(@Param('id') id: string): Promise<void> {
    await this.rules.deleteRule(id);
  }

  private assertTrigger(trigger: string): AutomationTrigger {
    if (!isAutomationTrigger(trigger)) {
      throw new BadRequestException(
        `Unknown automation trigger "${trigger}". Expected one of: ${AutomationTriggerValues.join(', ')}.`
      );
    }
    return trigger;
  }

  private toRuleInput(dto: AutomationRuleDefinitionDto): AutomationRuleInput {
    return {
      name: dto.name,
      trigger: this.assertTrigger(dto.trigger),
      triggerConfig: dto.triggerConfig,
      conditions: dto.conditions,
      actions: dto.actions,
      // Not `?? false`: the SERVICE owns the fail-closed default, and restating
      // it here would give "unarmed by omission" two places to disagree.
      isActive: dto.isActive,
      effectiveFrom: new Date(dto.effectiveFrom),
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
    };
  }

  /**
   * The §5.7 S3-2 acknowledgement, and the refusal when it is missing.
   *
   * Required only when ARMING a rule that carries an irreversible action: a
   * disarmed rule spends nothing, and a reversible one is recoverable. The actor
   * comes from the verified token, never from the body — a body-supplied actor
   * would let a caller attribute their own decision to someone else in the record
   * that exists to say who decided.
   *
   * Reads the submitted steps rather than the persisted rule, because the
   * acknowledgement is about what the operator is arming NOW; on a replace the
   * old definition is about to stop existing.
   *
   * **A step must be irreversible AND legal for the trigger to need an
   * acknowledgement.** This check runs before the service validates, so without
   * the legality arm a rule pairing `return.received` with `dispatch-shipment`
   * would be refused with "arming this needs an acknowledgement: it can
   * dispatch-shipment" — an acknowledgement demanded for an action that trigger
   * can never run, hiding the operator's actual problem behind a consent
   * prompt. With it, such a rule falls through to the §5.4 refusal that names
   * the illegal pair. It is also the honest rule: you acknowledge an action the
   * rule could actually run.
   */
  private resolveMoneyAck(
    dto: WriteAutomationRuleDto,
    input: AutomationRuleInput,
    user: AuthenticatedUser
  ): AutomationMoneyAckInput | null {
    const irreversible = input.actions
      .map((step) => (step as { action?: unknown }).action)
      .filter((action): action is string => typeof action === 'string')
      .filter(
        (action) =>
          isAutomationActionKind(action) &&
          isIrreversibleAction(action) &&
          isLegalAutomationPair(input.trigger, action),
      );

    if (irreversible.length === 0 || input.isActive !== true) {
      // Nothing to acknowledge. A `moneyAcknowledged: true` on such a rule is
      // ignored rather than stamped: recording consent for a money act that is
      // not being armed would put evidence on the row for a decision nobody made.
      return null;
    }
    if (dto.moneyAcknowledged !== true) {
      throw new BadRequestException(
        `Arming this rule needs an explicit acknowledgement: it can ${irreversible.join(' and ')}, ` +
          `which cannot be undone, and OpenLinker cannot test it for you first. ` +
          `Re-send with "moneyAcknowledged": true.`
      );
    }
    return { byUserId: user.id };
  }
}

