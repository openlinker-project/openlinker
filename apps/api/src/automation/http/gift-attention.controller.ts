/**
 * Gift Attention Controller (#3935)
 *
 * The two gift-only doors onto an order's automation runs: read why a gift is
 * missing, and record "send without the gift". Narrower than `/automations/runs`
 * on purpose: that surface is operator-only and exposes every automation's
 * steps, while this one answers only for add-gift firings of one order and
 * returns reason codes, never step detail.
 *
 * @module apps/api/src/automation/http/gift-attention.controller
 */
import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AUTOMATION_RUNS_READ_SERVICE_TOKEN,
  type AutomationRunView,
  type IAutomationRunsReadService,
} from '@openlinker/core/automation';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { Roles } from '../../auth/decorators/roles.decorator';
import { GiftAttentionItemDto, GiftAttentionResponseDto } from './dto/gift-attention.dto';

const NOT_ADDED = /^No gift added: (.+)\.$/;
const GIFT_ACTION = 'add-gift';
const GIFT_TRIGGER = 'order.ingested';
const RUN_WINDOW = 200;

interface GiftStepView {
  action?: unknown;
  reasonCode?: unknown;
  detail?: unknown;
  report?: unknown;
}

function giftStep(run: AutomationRunView): GiftStepView | undefined {
  for (const step of run.steps) {
    if (typeof step === 'object' && step !== null && (step as GiftStepView).action === GIFT_ACTION) {
      return step as GiftStepView;
    }
  }
  return undefined;
}

function isGiftRun(run: AutomationRunView): boolean {
  return run.trigger === GIFT_TRIGGER && giftStep(run) !== undefined;
}

/** The structured code when present; the "No gift added: <reason>." sentence is the fallback for older runs. */
function reasonCodeOf(run: AutomationRunView): string | null {
  const step = giftStep(run);
  if (step === undefined) return null;
  if (typeof step.reasonCode === 'string') return step.reasonCode;
  const message =
    step.report !== null && typeof step.report === 'object'
      ? (step.report as { message?: unknown }).message
      : undefined;
  const text = typeof step.detail === 'string' ? step.detail : typeof message === 'string' ? message : null;
  return text === null ? null : (NOT_ADDED.exec(text)?.[1] ?? null);
}

@ApiBearerAuth()
@ApiTags('gift-attention')
@Controller('orders/:internalOrderId/gift-attention')
export class GiftAttentionController {
  constructor(
    @Inject(AUTOMATION_RUNS_READ_SERVICE_TOKEN)
    private readonly runs: IAutomationRunsReadService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'Add-gift firings of this order that did not give their gift',
    description:
      'Only add-gift runs, failed or not applied, one per rule (the latest). Reason codes only: ' +
      'no step detail, cost or buyer data.',
  })
  @ApiParam({ name: 'internalOrderId', type: String })
  @ApiResponse({ status: 200, type: GiftAttentionResponseDto })
  async list(@Param('internalOrderId') internalOrderId: string): Promise<GiftAttentionResponseDto> {
    const page = await this.runs.listRecentBySubject('order', internalOrderId, RUN_WINDOW);
    const newestFirst = page.runs
      .filter(isGiftRun)
      .sort((a, b) => b.firedAt.getTime() - a.firedAt.getTime());
    const seen = new Set<string>();
    const items: GiftAttentionItemDto[] = [];
    for (const run of newestFirst) {
      if (seen.has(run.ruleId)) continue;
      seen.add(run.ruleId);
      if (run.outcome === 'done') continue;
      const item = new GiftAttentionItemDto();
      item.runId = run.id;
      item.ruleId = run.ruleId;
      item.ruleName = run.ruleName;
      item.outcome = run.outcome === 'failed' ? 'failed' : 'not-applied';
      item.reasonCode = run.outcome === 'failed' ? null : reasonCodeOf(run);
      item.dismissed = run.dismissedAt !== null;
      item.firedAt = run.firedAt.toISOString();
      items.push(item);
    }
    const dto = new GiftAttentionResponseDto();
    dto.items = items;
    dto.recordingAvailable = page.recordingAvailable;
    return dto;
  }

  @Post(':runId/skip')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Send this order without the gift',
    description:
      'Records that a person handled this add-gift firing. The run stays as it was; only the ' +
      'attention state clears. 404 when the run is not this order\'s, 409 when it is not an add-gift run.',
  })
  @ApiParam({ name: 'internalOrderId', type: String })
  @ApiParam({ name: 'runId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: GiftAttentionItemDto })
  @ApiResponse({ status: 404, description: 'No such run on this order' })
  @ApiResponse({ status: 409, description: 'The run is not an add-gift run' })
  async skip(
    @Param('internalOrderId') internalOrderId: string,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<GiftAttentionItemDto> {
    const run = await this.runs.getRunById(runId);
    if (run === null || run.subjectKind !== 'order' || run.subjectId !== internalOrderId) {
      throw new NotFoundException(`No gift run "${runId}" on order "${internalOrderId}".`);
    }
    if (!isGiftRun(run)) {
      throw new ConflictException(`Run "${runId}" is not an add-gift run.`);
    }
    const dismissed = await this.runs.dismiss(runId, user.id, new Date());
    if (dismissed === null) {
      throw new NotFoundException(`No gift run "${runId}" on order "${internalOrderId}".`);
    }
    const item = new GiftAttentionItemDto();
    item.runId = dismissed.id;
    item.ruleId = dismissed.ruleId;
    item.ruleName = dismissed.ruleName;
    item.outcome = dismissed.outcome === 'failed' ? 'failed' : 'not-applied';
    item.reasonCode = dismissed.outcome === 'failed' ? null : reasonCodeOf(dismissed);
    item.dismissed = dismissed.dismissedAt !== null;
    item.firedAt = dismissed.firedAt.toISOString();
    return item;
  }
}
