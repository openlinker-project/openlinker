/**
 * Fulfillment Work Controller (#2406, `W3a-19`, DESIGN §5.2, REVIEW C10)
 *
 * The operator worklist: filtered reads that carry `supportedActions` with the
 * resource, and one token-guarded action endpoint.
 *
 * ## Auth
 *
 * `JwtAuthGuard` is applied GLOBALLY, so per the house convention this file
 * *"never declares a redundant `@UseGuards(JwtAuthGuard)`"* (the invoicing /
 * refunds controllers state the same rule). Every route below is guarded;
 * `@Roles` narrows further — reads are open to `viewer`, actions are not,
 * because `visible` and `canWrite` are different answers.
 *
 * ## One action route, not a route per action
 *
 * The optimistic token must not be re-implementable per route, or one route
 * eventually ships without it — the #1487 choke-point rule. `:action` is
 * validated against `OPERATOR_INVOCABLE_ACTIONS`, the same constant the read
 * model filters `supportedActions` with, so the actions offered and the actions
 * accepted are one list with two readers and cannot drift.
 *
 * @module apps/api/src/fulfillment/http
 */
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Body,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  FulfillmentHoldAlreadyReleasedError,
  FulfillmentHoldLimitExceededError,
  FulfillmentHoldNotFoundError,
  FulfillmentWorkActionNotLegalError,
  FulfillmentWorkNotFoundError,
  FulfillmentWorkVersionConflictError,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  isOperatorInvocableAction,
  MissingFulfillmentWorkActionFieldError,
  type FulfillmentWorkConflictCode,
  OPERATOR_INVOCABLE_ACTIONS,
  UnsupportedFulfillmentWorkActionError,
  type FulfillmentWorkPageView,
  type FulfillmentWorkView,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';

// Value imports (not `import type`): the @CurrentUser() param type feeds
// decorator metadata, so erasing it breaks the emitted signature.
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ApplyFulfillmentWorkActionDto } from './dto/apply-fulfillment-work-action.dto';
import {
  FulfillmentWorkActionNotLegalResponseDto,
  FulfillmentWorkConflictResponseDto,
  FulfillmentWorkPageResponseDto,
  FulfillmentWorkResponseDto,
} from './dto/fulfillment-work-response.dto';
import { ListFulfillmentWorksQueryDto } from './dto/list-fulfillment-works-query.dto';

@ApiBearerAuth()
@ApiTags('fulfillment')
@Controller('fulfillment/works')
export class FulfillmentWorkController {
  constructor(
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'List fulfilment tasks',
    description:
      'Filtered, bounded page. Each row carries the actions that are legal on it right now and ' +
      'the optimistic token required to act on them.',
  })
  @ApiResponse({ status: 200, type: FulfillmentWorkPageResponseDto })
  async list(
    @Query() query: ListFulfillmentWorksQueryDto
  ): Promise<FulfillmentWorkPageResponseDto> {
    const page = await this.worklist.list({
      status: query.status,
      requestStatus: query.requestStatus,
      locationId: query.locationId,
      orderId: query.orderId,
      limit: query.limit,
      offset: query.offset,
    });
    return this.toPageDto(page);
  }

  @Get(':workId')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Get one fulfilment task' })
  @ApiResponse({ status: 200, type: FulfillmentWorkResponseDto })
  @ApiResponse({ status: 404, description: 'No such fulfilment task' })
  async get(@Param('workId') workId: string): Promise<FulfillmentWorkResponseDto> {
    try {
      return this.toDto(await this.worklist.get(workId));
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Post(':workId/actions/:action')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Apply an action to a fulfilment task',
    description:
      'Requires the optimistic token read with the task. A stale token answers 409 carrying the ' +
      'refreshed supportedActions — never a silent overwrite.',
  })
  @ApiResponse({ status: 201, type: FulfillmentWorkResponseDto })
  @ApiResponse({ status: 400, description: 'Not an operator-invocable action, or a missing field' })
  @ApiResponse({ status: 404, description: 'No such fulfilment task or hold' })
  @ApiResponse({
    status: 409,
    description:
      'Stale token (code=version_conflict, retryable) or the action is no longer legal ' +
      '(code=action_not_legal, not retryable). Both carry the refreshed supportedActions.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(FulfillmentWorkConflictResponseDto) },
        { $ref: getSchemaPath(FulfillmentWorkActionNotLegalResponseDto) },
      ],
    },
  })
  @ApiExtraModels(FulfillmentWorkConflictResponseDto, FulfillmentWorkActionNotLegalResponseDto)
  async applyAction(
    @Param('workId') workId: string,
    @Param('action') action: string,
    @Body() body: ApplyFulfillmentWorkActionDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<FulfillmentWorkResponseDto> {
    // Validated against the SAME constant the read model filters with, so a
    // client can never be offered an action this route would reject.
    if (!isOperatorInvocableAction(action)) {
      throw new BadRequestException(
        `'${action}' is not an operator-invocable fulfilment action; ` +
          `invocable: ${OPERATOR_INVOCABLE_ACTIONS.join(', ')}`
      );
    }

    try {
      return this.toDto(
        await this.worklist.applyAction({
          workId,
          action,
          expectedVersion: body.expectedVersion,
          holdReason: body.holdReason,
          cancellationReason: body.cancellationReason,
          holdId: body.holdId,
          note: body.note ?? null,
          releaseNote: body.releaseNote ?? null,
          // Threaded, never dropped: `placeHold` / `releaseHold` persist this as
          // `placedByUserId` / `releasedByUserId`. Leaving it undefined would
          // write a null actor on every hold taken through the operator UI —
          // the audit column exists precisely to answer "who suspended this".
          actorUserId: user.id,
        })
      );
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  /**
   * Map every domain error this surface can reach.
   *
   * Anything unmapped becomes a 500, so the three hold errors are listed
   * explicitly — all of them are reachable from `hold` / `release_hold`, and the
   * port stresses that not-found and already-released are *different facts*.
   */
  private toHttp(error: unknown): Error {
    if (error instanceof FulfillmentWorkVersionConflictError) {
      // The refreshed action set rides in the body: the client re-renders its
      // controls and retries without a second GET.
      //
      // `code` is the DISCRIMINATOR. Both refusals below are 409 and both carry
      // a refreshed action set, but only this one is retryable — so a client
      // must not be left inferring which it got from whether `currentVersion`
      // happens to be present.
      return new ConflictException({
        code: 'version_conflict' satisfies FulfillmentWorkConflictCode,
        message: error.message,
        workId: error.workId,
        expectedVersion: error.expectedVersion,
        currentVersion: error.currentVersion,
        supportedActions: [...error.supportedActions],
      });
    }
    if (error instanceof FulfillmentWorkActionNotLegalError) {
      // Same status, different fact: the token was current, the state refused.
      // Re-sending the identical request fails identically, so a client must
      // surface it rather than retry.
      return new ConflictException({
        code: 'action_not_legal' satisfies FulfillmentWorkConflictCode,
        message: error.message,
        workId: error.workId,
        action: error.action,
        supportedActions: [...error.supportedActions],
      });
    }
    // Both are 400 — a malformed request, not a state conflict — but they are
    // different facts: an action this surface does not execute, versus an
    // action it does execute called without a field it needs.
    if (
      error instanceof UnsupportedFulfillmentWorkActionError ||
      error instanceof MissingFulfillmentWorkActionFieldError
    ) {
      return new BadRequestException(error.message);
    }
    if (
      error instanceof FulfillmentWorkNotFoundError ||
      error instanceof FulfillmentHoldNotFoundError
    ) {
      return new NotFoundException(error.message);
    }
    if (
      error instanceof FulfillmentHoldLimitExceededError ||
      error instanceof FulfillmentHoldAlreadyReleasedError
    ) {
      return new ConflictException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private toPageDto(page: FulfillmentWorkPageView): FulfillmentWorkPageResponseDto {
    return {
      works: page.works.map((work) => this.toDto(work)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  private toDto(view: FulfillmentWorkView): FulfillmentWorkResponseDto {
    // Field-by-field, never a spread — see the DTO module docblock.
    return {
      id: view.id,
      orderId: view.orderId,
      locationId: view.locationId,
      deliveryMethod: view.deliveryMethod,
      assignedConnectionId: view.assignedConnectionId,
      status: view.status,
      requestStatus: view.requestStatus,
      assignmentAttempt: view.assignmentAttempt,
      cancellationReason: view.cancellationReason,
      externalWorkId: view.externalWorkId,
      acceptedAt: view.acceptedAt,
      cancelledAt: view.cancelledAt,
      expeditedAt: view.expeditedAt,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      lines: view.lines.map((line) => ({
        id: line.id,
        orderLineId: line.orderLineId,
        productVariantId: line.productVariantId,
        totalQuantity: line.totalQuantity,
        fulfilledQuantity: line.fulfilledQuantity,
        cancelledQuantity: line.cancelledQuantity,
      })),
      activeHolds: view.activeHolds.map((hold) => ({
        id: hold.id,
        reason: hold.reason,
        note: hold.note,
        placedAt: hold.placedAt,
      })),
      supportedActions: [...view.supportedActions],
      version: view.version,
    };
  }
}
