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
  Patch,
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
  EmptyFulfillmentWorkAssignmentUpdateError,
  ExclusiveAssignmentRequiresPackerError,
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
import { LOCATION_SERVICE_TOKEN, type ILocationService } from '@openlinker/core/inventory';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService, type OrderRecord } from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';

// Value imports (not `import type`): the @CurrentUser() param type feeds
// decorator metadata, so erasing it breaks the emitted signature.
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  readCarrierName,
  readMaskedBuyerName,
  readOrderReferenceOrNull,
} from '../application/fulfillment-work-order-facts';
import { ApplyFulfillmentWorkActionDto } from './dto/apply-fulfillment-work-action.dto';
import {
  FulfillmentWorkActionNotLegalResponseDto,
  FulfillmentWorkConflictResponseDto,
  FulfillmentWorkPageResponseDto,
  FulfillmentWorkResponseDto,
} from './dto/fulfillment-work-response.dto';
import { ListFulfillmentWorksQueryDto } from './dto/list-fulfillment-works-query.dto';
import { UpdateFulfillmentWorkAssignmentDto } from './dto/update-fulfillment-work-assignment.dto';

/**
 * The page's human-readable facts, resolved once (#3426).
 *
 * Maps, never arrays: a miss is `undefined` and reads as `null`, so nothing
 * positionally zips a batched result against the ids it was asked for.
 */
interface WorklistFacts {
  readonly orderById: Map<string, OrderRecord>;
  readonly locationNameById: Map<string, string>;
  readonly productNameByVariantId: Map<string, string | null>;
}

@ApiBearerAuth()
@ApiTags('fulfillment')
@Controller('fulfillment/works')
export class FulfillmentWorkController {
  constructor(
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    @Inject(LOCATION_SERVICE_TOKEN)
    private readonly locations: ILocationService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
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
    return await this.toPageDto(page);
  }

  /**
   * Every human-readable fact this board renders, resolved for a WHOLE PAGE in
   * a constant number of batched reads (#3425 / #3426) — never one per row.
   *
   * Four queries, whatever the page size, and the count is pinned by a spec
   * (`resolves a page of N works in a CONSTANT number of reads`) rather than
   * left as an intention. The #2083 `getEarliestOrderDateByConnection` /
   * #1713 `getLatestInvoicesForOrders` rule: one query per concern across all
   * the page's ids.
   *
   * Three of the four run concurrently; products must follow variants, because
   * `ProductVariant` carries no name of its own — the name is on `Product`, so
   * the variant read is what supplies the product ids (the same two-step the
   * bench's `describeLines` takes).
   *
   * Every lookup is a `Map` keyed off the result, and an absent id reads as
   * `null`. Nothing here positionally zips a result array against its input.
   */
  private async loadFacts(works: readonly FulfillmentWorkView[]): Promise<WorklistFacts> {
    const orderIds = [...new Set(works.map((w) => w.orderId))];
    const locationIds = [
      ...new Set(works.map((w) => w.locationId).filter((id): id is string => id !== null)),
    ];
    const variantIds = [
      ...new Set(works.flatMap((w) => w.lines.map((line) => line.productVariantId))),
    ];

    const [orders, locations, variants] = await Promise.all([
      orderIds.length === 0 ? Promise.resolve([]) : this.orders.findByIds(orderIds),
      locationIds.length === 0
        ? Promise.resolve([])
        : this.locations.getLocationsByIds(locationIds),
      variantIds.length === 0 ? Promise.resolve([]) : this.products.getVariantsByIds(variantIds),
    ]);

    const productIds = [...new Set(variants.map((variant) => variant.productId))];
    const products =
      productIds.length === 0 ? [] : await this.products.getProductsByIds(productIds);

    const productById = new Map(products.map((product) => [product.id, product]));
    return {
      orderById: new Map(orders.map((order) => [order.internalOrderId, order])),
      locationNameById: new Map(locations.map((location) => [location.id, location.name])),
      // Collapsed to the one fact a line renders, so nothing downstream can
      // reach a variant or a product field this response has not allowlisted.
      productNameByVariantId: new Map(
        variants.map((variant) => [
          variant.id,
          productById.get(variant.productId)?.name ?? null,
        ])
      ),
    };
  }

  @Get(':workId')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Get one fulfilment task' })
  @ApiResponse({ status: 200, type: FulfillmentWorkResponseDto })
  @ApiResponse({ status: 404, description: 'No such fulfilment task' })
  async get(@Param('workId') workId: string): Promise<FulfillmentWorkResponseDto> {
    try {
      const work = await this.worklist.get(workId);
      return this.toDto(work, await this.loadFacts([work]));
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
      const work = await this.worklist.applyAction({
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
      });
      return this.toDto(work, await this.loadFacts([work]));
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Patch(':workId/assignment')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: "A supervisor's staffing decision for one parcel",
    description:
      "Pre-assign, reassign or clear a packer, and/or set whether other packers may still " +
      'work it. ADR-074 places this outside the authority-matrix LEGALITY `applyAction`\'s ' +
      "actions enforce — which system may act — but that says nothing about a lost-update " +
      'guard, which is an orthogonal concern: an OPTIONAL `expectedVersion` protects a ' +
      "caller's own read from being silently overwritten by a peer's write it never saw. " +
      'A mismatch answers 409 with the current version and a refreshed action set, the same ' +
      'shape every other guarded action on this surface already answers with.',
  })
  @ApiResponse({ status: 200, type: FulfillmentWorkResponseDto })
  @ApiResponse({ status: 400, description: 'Neither field was supplied' })
  @ApiResponse({ status: 404, description: 'No such fulfilment task' })
  @ApiResponse({
    status: 409,
    description: 'expectedVersion was supplied and somebody else moved the work first',
  })
  async updateAssignment(
    @Param('workId') workId: string,
    @Body() body: UpdateFulfillmentWorkAssignmentDto
  ): Promise<FulfillmentWorkResponseDto> {
    try {
      const work = await this.worklist.updateAssignment({
        workId,
        assignedToUserId: body.assignedToUserId,
        selfServeEligible: body.selfServeEligible,
        expectedVersion: body.expectedVersion,
      });
      return this.toDto(work, await this.loadFacts([work]));
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
      error instanceof MissingFulfillmentWorkActionFieldError ||
      error instanceof EmptyFulfillmentWorkAssignmentUpdateError
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
      error instanceof FulfillmentHoldAlreadyReleasedError ||
      // 409 rather than 400 (ADR-074, #3360): the request is well formed and
      // the work object exists — its STATE refuses, because a parcel with no
      // assigned packer has nobody to be exclusive to. Assigning it and
      // re-sending succeeds, which is what separates this from the 400s above.
      error instanceof ExclusiveAssignmentRequiresPackerError
    ) {
      return new ConflictException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private async toPageDto(page: FulfillmentWorkPageView): Promise<FulfillmentWorkPageResponseDto> {
    // ONE resolution for the whole page, then a pure map per row.
    const facts = await this.loadFacts(page.works);
    return {
      works: page.works.map((work) => this.toDto(work, facts)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  private toDto(view: FulfillmentWorkView, facts: WorklistFacts): FulfillmentWorkResponseDto {
    const order: OrderRecord | undefined = facts.orderById.get(view.orderId);
    // Field-by-field, never a spread — see the DTO module docblock.
    return {
      id: view.id,
      orderId: view.orderId,
      // #3426 — the source's own reference. `null`, not the internal id: see
      // `readOrderReferenceOrNull` for why this board declines that fallback.
      orderReference: readOrderReferenceOrNull(order),
      locationId: view.locationId,
      locationName:
        view.locationId === null ? null : (facts.locationNameById.get(view.locationId) ?? null),
      deliveryMethod: view.deliveryMethod,
      assignedConnectionId: view.assignedConnectionId,
      assignedToUserId: view.assignedToUserId,
      unassignedSince: view.unassignedSince,
      selfServeEligible: view.selfServeEligible,
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
      // #3425 (epic #3401) — a deliberate, MASKED reversal of ADR-062's
      // buyer-PII exclusion on this board. The full name is never resolved
      // here — readMaskedBuyerName masks internally and this file never
      // sees the unmasked value.
      buyerNameMasked: readMaskedBuyerName(order),
      dispatchByAt: order?.dispatchByAt?.toISOString() ?? null,
      carrierName: readCarrierName(order),
      lines: view.lines.map((line) => ({
        id: line.id,
        orderLineId: line.orderLineId,
        productVariantId: line.productVariantId,
        // #3426 — the parent product's name. `null`, never a placeholder that
        // reads like a name: a variant absent from the catalogue is a fact an
        // operator can act on, and a fabricated label is not.
        productName: facts.productNameByVariantId.get(line.productVariantId) ?? null,
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
