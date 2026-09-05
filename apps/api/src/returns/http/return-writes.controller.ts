/**
 * Return Writes Controller (#2376, `W2-39`)
 *
 * Every Wave-2 returns write that is not the one #2333 already shipped: the
 * three per-line custody acts, authorize, match-to-order, the operator-authored
 * record, the refund confirmation, and the credit-note proposal pair.
 *
 * A sibling of `ReturnActionsController` rather than an extension of it, for the
 * reason that file's own docblock gives for existing separately from the read
 * controller: `decline` is the one write that crosses an ADAPTER boundary and
 * asks a source for something, and keeping it in its own file keeps that
 * distinction legible. Both mount the same `returns` prefix and Nest composes
 * them into one resource.
 *
 * ## What is deliberately NOT here
 *
 * `POST /returns/:id/commission-refund/claim`. There is no service to call —
 * `W2-37` (#2379) has not landed, and SPIKE-2375 leaves the shape undecided
 * (a real Allegro write, or a deep link plus an operator attestation). Shipping
 * a 501 placeholder would advertise a capability OpenLinker does not have;
 * inventing an attestation contract here would decide, at the HTTP layer, a
 * question the spike exists to answer.
 *
 * ## Three rules every route here follows
 *
 * 1. **The actor comes from the verified token**, never the body — a
 *    body-supplied `actorUserId` would let a caller attribute their own act to
 *    someone else in the audit trail these records exist to be.
 * 2. **Domain refusals are not caught here.** `ReturnsExceptionFilter` maps all
 *    fourteen globally, so a second caller of the same service cannot answer
 *    differently. The one local catch is `DuplicateRefundRecordException`, which
 *    belongs to `orders` and which that filter therefore cannot see.
 * 3. **A blocked restock is a 2xx.** The disposition succeeded and is recorded;
 *    only the inventory-master write failed.
 * 4. **A nested route VERIFIES its nesting.** The custody service keys on the
 *    globally-unique `lineId` alone, so `:returnId` is not needed to perform the
 *    write — which is exactly why it must be checked. Left unverified, a URL
 *    naming the wrong return would succeed against a line belonging to another
 *    one, and anything correlating an audit trail on the path would record the
 *    wrong parent. `assertLineBelongsToReturn` costs one read and makes the URL
 *    true.
 *
 * @module apps/api/src/returns/http
 */
import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ORDER_REFUND_SERVICE_TOKEN,
  type IOrderRefundService,
} from '@openlinker/core/orders';
import {
  RETURN_AUTHORIZE_SERVICE_TOKEN,
  RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN,
  RETURN_CUSTODY_SERVICE_TOKEN,
  RETURN_REFUND_SERVICE_TOKEN,
  RETURNS_SERVICE_TOKEN,
  ReturnLineNotFoundError,
  ReturnNotFoundError,
  describeCorrectionNoMatchReason,
  type AttestStockResult,
  type DisposeLineResult,
  type IReturnAuthorizeService,
  type IReturnCorrectionProposalService,
  type IReturnCustodyService,
  type IReturnRefundService,
  type IReturnsService,
  type ReceiveLineResult,
  type RestockBlockedDetail,
  type ReturnCorrectionProposalResult,
  type ReturnLine,
} from '@openlinker/core/returns';
import { Logger } from '@openlinker/shared/logging';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type {
  RestockBlockedResponseDto,
  ReturnLineCountersDto} from '../dto/return-custody.dto';
import {
  AttestReturnLineStockDto,
  AttestReturnLineStockResponseDto,
  DisposeReturnLineDto,
  DisposeReturnLineResponseDto,
  MarkReturnLineNotReturnedDto,
  MarkReturnLineNotReturnedResponseDto,
  ReceiveReturnLineDto,
  ReceiveReturnLineResponseDto
} from '../dto/return-custody.dto';
import {
  AuthorizeReturnResponseDto,
  ConfirmReturnRefundDto,
  ConfirmReturnRefundResponseDto,
  MatchReturnToOrderDto,
  MatchReturnToOrderResponseDto,
  RecordReturnDto,
  RecordReturnResponseDto,
} from '../dto/return-write.dto';
import { ReturnCorrectionProposalResponseDto } from '../dto/return-correction-proposal.dto';

@ApiBearerAuth()
@ApiTags('returns')
@Controller('returns')
export class ReturnWritesController {
  private readonly logger = new Logger(ReturnWritesController.name);

  constructor(
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returns: IReturnsService,
    @Inject(RETURN_CUSTODY_SERVICE_TOKEN)
    private readonly custody: IReturnCustodyService,
    @Inject(RETURN_AUTHORIZE_SERVICE_TOKEN)
    private readonly authorizeService: IReturnAuthorizeService,
    @Inject(RETURN_REFUND_SERVICE_TOKEN)
    private readonly refunds: IReturnRefundService,
    @Inject(RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN)
    private readonly proposals: IReturnCorrectionProposalService,
    @Inject(ORDER_REFUND_SERVICE_TOKEN)
    private readonly orderRefunds: IOrderRefundService
  ) {}

  // Declared FIRST, before any `:returnId` route: `record` is a literal segment
  // on the same prefix, and the read controller already avoids this hazard by
  // declaring `ingestion-availability` ahead of `:returnId`.
  @Post('record')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Open a return in OpenLinker against an order it already knows',
    description:
      'For a source with no returns surface at all. The record is `operator_authored` with no ' +
      'external return id — OpenLinker never synthesises a source key, because the row would then ' +
      'claim a source it has not got. `sourceConnectionId` is validated, not guessed: the order ' +
      'must actually map to that channel.',
  })
  @ApiResponse({ status: 201, type: RecordReturnResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'The payload was inapplicable — `no-lines`, `invalid-quantity`, `unknown-order` or ' +
      '`order-not-on-connection`, in the response `reason`.',
  })
  async record(
    @Body() dto: RecordReturnDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<RecordReturnResponseDto> {
    const record = await this.returns.recordReturn({
      internalOrderId: dto.internalOrderId,
      sourceConnectionId: dto.sourceConnectionId,
      lines: dto.lines.map((line) => ({
        sku: line.sku ?? null,
        name: line.name ?? null,
        reason: line.reason,
        quantityAdvised: line.quantityAdvised,
        note: line.note ?? null,
      })),
      actorUserId: user.id,
    });

    return {
      returnId: record.id,
      internalOrderId: record.internalOrderId,
      origin: record.origin,
      openedAt: (record.openedAt ?? record.createdAt).toISOString(),
    };
  }

  @Post(':returnId/authorize')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Authorize an operator-authored return',
    description:
      'Restricted to `operator_authored` returns: OpenLinker must not pretend to decide what a ' +
      'marketplace already decided, so a source-ingested return is refused with a named reason ' +
      'rather than silently doing nothing. Crosses no adapter boundary — for a return OpenLinker ' +
      'itself authored there is no source to ask, so the row is the audit record of the act.',
  })
  @ApiResponse({ status: 201, type: AuthorizeReturnResponseDto })
  @ApiResponse({ status: 404, description: 'Return not found' })
  @ApiResponse({
    status: 409,
    description:
      'The return is an orphan, or it was ingested from a source (`reason: source-ingested`).',
  })
  async authorize(
    @Param('returnId') returnId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AuthorizeReturnResponseDto> {
    const result = await this.authorizeService.authorize({ returnId, actorUserId: user.id });

    return {
      outcome: result.outcome,
      changeId: result.changeId,
      authorizedAt: result.authorizedAt ? result.authorizedAt.toISOString() : null,
    };
  }

  @Post(':returnId/match-order')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Attribute an orphan return to an order',
    description:
      'The operator way out of the orphan bucket, and it unblocks every downstream trigger by ' +
      'construction. **Attribution is monotonic — there is no unmatch**, so a client must confirm ' +
      'before calling this. The order is proved through `identifier_mappings` (an id OpenLinker ' +
      'minted while ingesting), deliberately unscoped by connection: an order ingested under a ' +
      'DIFFERENT connection is one of the documented orphan causes.',
  })
  @ApiResponse({ status: 201, type: MatchReturnToOrderResponseDto })
  @ApiResponse({ status: 400, description: 'The order id names nothing (`reason: unknown-order`)' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  @ApiResponse({
    status: 409,
    description: 'The return is already attributed (`reason: already-attributed`)',
  })
  async matchOrder(
    @Param('returnId') returnId: string,
    @Body() dto: MatchReturnToOrderDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<MatchReturnToOrderResponseDto> {
    const record = await this.returns.matchOrphanToOrder({
      returnId,
      internalOrderId: dto.internalOrderId,
      actorUserId: user.id,
    });

    return {
      returnId: record.id,
      internalOrderId: record.internalOrderId,
      matchedAt: record.matchedAt ? record.matchedAt.toISOString() : null,
    };
  }

  @Post(':returnId/lines/:lineId/receive')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Record that more units of a return line arrived',
    description:
      'Crosses no boundary and moves no stock, so it is deliberately NOT gated on attribution: a ' +
      'parcel arriving at the operator building is a fact whether or not OpenLinker can name its ' +
      'order, and refusing to record it would make the orphan bucket useless for exactly the ' +
      'returns it exists to hold.',
  })
  @ApiResponse({ status: 201, type: ReceiveReturnLineResponseDto })
  @ApiResponse({ status: 404, description: 'Return line not found' })
  @ApiResponse({
    status: 409,
    description:
      'The counters refuse the receipt. `reason` carries the actionable code — `over-receipt` when ' +
      'it would push `quantityReceived` past `quantityAdvised`, or `illegal-transition`.',
  })
  async receiveLine(
    @Param('returnId') returnId: string,
    @Param('lineId') lineId: string,
    @Body() dto: ReceiveReturnLineDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ReceiveReturnLineResponseDto> {
    await this.assertLineBelongsToReturn(returnId, lineId);

    const result: ReceiveLineResult = await this.custody.receiveLine(lineId, {
      quantity: dto.quantity,
      note: dto.note ?? null,
      actorUserId: user.id,
    });

    return { line: this.toCountersDto(result.line), eventId: result.event.id };
  }

  @Post(':returnId/lines/:lineId/mark-not-returned')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Record that this line\'s parcel is not coming',
    description:
      '**Always an operator act, never a timeout and never a sweep** (spec § 5.2) — a parcel that ' +
      'has not arrived is not the same fact as a parcel that is not coming, and only a human is in ' +
      'a position to assert the second. Despite the spec\'s *"Mark remainder not returned"* ' +
      'phrasing this is NOT a shortfall write: the model refuses a partially received line, ' +
      'because custody is single-valued and there is no `quantityNotReturned` counter for a ' +
      'shortfall to move into. Where units did arrive the shortfall stays visible as ' +
      '`quantityAdvised - quantityReceived`. Crosses no boundary and moves no stock, so — like ' +
      'the receipt — it is deliberately not gated on attribution.',
  })
  @ApiResponse({ status: 201, type: MarkReturnLineNotReturnedResponseDto })
  @ApiResponse({ status: 404, description: 'Return line not found' })
  @ApiResponse({
    status: 409,
    description:
      'The line refuses. `reason` carries the actionable code — `partially-received` when units ' +
      'have already arrived, `nothing-advised` when the source advised none, or ' +
      '`illegal-transition` from a terminal state.',
  })
  async markLineNotReturned(
    @Param('returnId') returnId: string,
    @Param('lineId') lineId: string,
    @Body() dto: MarkReturnLineNotReturnedDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<MarkReturnLineNotReturnedResponseDto> {
    await this.assertLineBelongsToReturn(returnId, lineId);

    const result = await this.custody.markLineNotReturned(lineId, {
      note: dto.note ?? null,
      actorUserId: user.id,
    });

    return { line: this.toCountersDto(result.line), eventId: result.event.id };
  }

  @Post(':returnId/lines/:lineId/dispose')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Record what became of received units',
    description:
      '`restock` writes the inventory master; `scrap` writes the units off and changes no stock. ' +
      'A refused master write does NOT fail this call and does NOT roll the disposition back — ' +
      'the goods really were disposed of, and the act is persisted. What it does not do is move ' +
      '`quantityRestocked`: the units stay in `quantityReceived` until an operator attests, so ' +
      'nothing anywhere reports them as restocked. That case returns **2xx** with `restockBlocked`.',
  })
  @ApiResponse({ status: 201, type: DisposeReturnLineResponseDto })
  @ApiResponse({ status: 404, description: 'Return line not found' })
  @ApiResponse({
    status: 409,
    description:
      'The counters refuse the disposition (`reason: over-disposition` / `illegal-transition`), ' +
      'the return is an orphan (restock only — an orphan restocks nothing), or another custody ' +
      'write holds the line (retryable).',
  })
  async disposeLine(
    @Param('returnId') returnId: string,
    @Param('lineId') lineId: string,
    @Body() dto: DisposeReturnLineDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<DisposeReturnLineResponseDto> {
    await this.assertLineBelongsToReturn(returnId, lineId);

    const result: DisposeLineResult = await this.custody.disposeLine(lineId, {
      quantity: dto.quantity,
      disposition: dto.disposition,
      note: dto.note ?? null,
      actorUserId: user.id,
    });

    return {
      line: this.toCountersDto(result.line),
      eventId: result.event.id,
      restockBlocked: this.toRestockBlockedDto(result.restockBlocked),
    };
  }

  @Post(':returnId/lines/:lineId/mark-stock-handled')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Attest that a refused restock was handled manually',
    description:
      'Settles every outstanding `blocked` / `in_doubt` restock act on the line, moving their units ' +
      'into `quantityRestocked` and recording who attested. **It never writes stock and never ' +
      'claims OpenLinker did** — the timeline keeps both the block and the attestation ' +
      'permanently; only the attention clears.',
  })
  @ApiResponse({ status: 201, type: AttestReturnLineStockResponseDto })
  @ApiResponse({ status: 404, description: 'Return line not found' })
  @ApiResponse({ status: 409, description: 'Nothing outstanding to attest' })
  async markStockHandled(
    @Param('returnId') returnId: string,
    @Param('lineId') lineId: string,
    @Body() dto: AttestReturnLineStockDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AttestReturnLineStockResponseDto> {
    await this.assertLineBelongsToReturn(returnId, lineId);

    const result: AttestStockResult = await this.custody.markStockHandledManually(lineId, {
      actorUserId: user.id,
      note: dto.note ?? null,
    });

    return {
      line: this.toCountersDto(result.line),
      eventIds: result.events.map((event) => event.id),
    };
  }

  @Post(':returnId/refund')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Confirm that the buyer was refunded',
    description:
      'OpenLinker does not move money. This records that the operator did, against this return and ' +
      'its order, and moves the money rail to `triggered` — `refunded` is only ever entered on a ' +
      'source observation. Two writes happen and they are not atomic (two contexts, two ' +
      'repositories): the money state settles FIRST and durably, then the linked `RefundRecord` is ' +
      'written. If the second fails this still answers 2xx with `refundRecordWritten: false`, ' +
      'because the primary outcome succeeded — reporting a failure would send the operator to ' +
      'retry, and the retry would answer 409 `already-attempted`.',
  })
  @ApiResponse({ status: 201, type: ConfirmReturnRefundResponseDto })
  @ApiResponse({ status: 404, description: 'Return not found' })
  @ApiResponse({
    status: 409,
    description:
      'The return is an orphan, no line is refund-attemptable (`reason: no-lines` / ' +
      '`already-attempted` / `outstanding-in-doubt`), or a concurrent attempt holds it (retryable).',
  })
  async confirmRefund(
    @Param('returnId') returnId: string,
    @Body() dto: ConfirmReturnRefundDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ConfirmReturnRefundResponseDto> {
    const result = await this.refunds.triggerRefund(returnId, {
      amount: dto.amount,
      currency: dto.currency,
      reason: dto.reason,
      note: dto.note ?? null,
      actorUserId: user.id,
    });

    const base = {
      moneyState: result.moneyState,
      claimedLineIds: result.claimedLineIds,
      providerMessage: result.providerMessage,
    };

    const intent = result.refundRecordIntent;
    if (intent === null) {
      // A `denied` / `in_doubt` outcome: the attempt is recorded and there was
      // nothing to write. Not a failure, and distinct from a failed write.
      return {
        ...base,
        moneyMoved: false,
        refundRecordWritten: false,
        refundRecordId: null,
        refundRecordError: null,
      };
    }

    try {
      const record = await this.orderRefunds.recordRefund({
        internalOrderId: intent.internalOrderId,
        amount: intent.amount,
        currency: intent.currency,
        reason: intent.reason,
        note: intent.note,
        recordedAt: intent.recordedAt,
        executedBy: intent.executedBy,
        // NOTE: `intent.providerRefundId` is deliberately NOT forwarded —
        // `CreateRefundRecordInput` has no field for it. That is a real gap, not
        // an omission here: the intent carries the value because a future
        // `RefundExecutor` capability would report one, and `orders` will need a
        // column before it can be stored. Today every shipped path is
        // `operator_out_of_band`, where it is always null, so nothing is lost.
        returnId: intent.returnId,
        // Deterministic per ATTEMPT, so one attempt cannot insert twice and
        // inflate `RefundSummary.totalAmount`. A second attempt claims different
        // lines (the first attempt's are no longer attemptable), so a legitimate
        // partial refund still gets its own key.
        idempotencyKey: `return:${intent.returnId}:${[...result.claimedLineIds].sort().join('+')}`,
      });

      return {
        ...base,
        moneyMoved: true,
        refundRecordWritten: true,
        refundRecordId: record.id,
        refundRecordError: null,
      };
    } catch (error) {
      // The money state has already settled durably. Reporting a 5xx here would
      // claim the refund failed when it did not — see the route description.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Refund money state settled for return ${returnId} but the linked RefundRecord write ` +
          `failed: ${message}. Capture it on the order via POST /orders/${intent.internalOrderId}/refunds.`,
        error instanceof Error ? error.stack : undefined
      );

      return {
        ...base,
        moneyMoved: true,
        refundRecordWritten: false,
        refundRecordId: null,
        refundRecordError: message,
      };
    }
  }

  // NOT `@AnyRole()` (#2905 review). The DTO carries `invoiceRecordId`,
  // `invoiceConnectionId`, `invoiceDocumentNumber`, `currency` and a per-line
  // `taxRate` — and it is WALKABLE, because `ReturnsController.listReturns` is
  // reachable by the same session, so a return id is one request away. #2413's
  // principle is that the bench reaches a parcel through its work and is
  // excluded from every register; a fiscal document reached by enumerating
  // returns is that trap one context over, and it caught `/orders` once already.
  @Roles('admin', 'operator', 'viewer')
  @Get(':returnId/correction-proposal')
  @ApiOperation({
    summary: 'Preview the credit-note correction proposal',
    description:
      'A **read** — it persists nothing. Matches the return disposed lines against the invoice ' +
      'issued-line snapshot and classifies each: `matched` (one candidate), `ambiguous` (several, ' +
      'ALL listed, none selected — the operator picks) or `no-match` (excluded, with its reason). ' +
      'Nothing here issues a correction, and auto-issue is not offered: invoice lines carry no ' +
      'stable reference, so a machine cannot resolve the ambiguity honestly.',
  })
  @ApiResponse({ status: 200, type: ReturnCorrectionProposalResponseDto })
  @ApiResponse({ status: 404, description: 'Return not found' })
  @ApiResponse({ status: 409, description: 'The return is an orphan — attribute it first' })
  async previewCorrectionProposal(
    @Param('returnId') returnId: string
  ): Promise<ReturnCorrectionProposalResponseDto> {
    return this.toProposalDto(await this.proposals.previewProposal(returnId));
  }

  @Post(':returnId/correction-proposal')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Record the credit-note correction proposal for review',
    description:
      'The same computation as the GET, additionally recorded as an ADR-044 change proposal an ' +
      'operator will confirm through the existing correction flow. **Issues nothing.** An ' +
      'identical open proposal is reused; a diverged one is replaced, so the recorded row always ' +
      'matches what is shown. The row holds no operator picks — a pick for an ambiguous line ' +
      'belongs to the confirm request, or the next call would destroy it.',
  })
  @ApiResponse({ status: 201, type: ReturnCorrectionProposalResponseDto })
  @ApiResponse({ status: 404, description: 'Return not found' })
  @ApiResponse({ status: 409, description: 'The return is an orphan — attribute it first' })
  async recordCorrectionProposal(
    @Param('returnId') returnId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ReturnCorrectionProposalResponseDto> {
    return this.toProposalDto(
      await this.proposals.buildProposal({ returnId, actorUserId: user.id })
    );
  }

  /**
   * Make the nested route's claim true.
   *
   * The custody writes key on `lineId`, which is globally unique — so this check
   * is not needed to perform them, and that is precisely why it has to exist.
   * Without it the URL asserts a parent-child relationship nothing verifies, and
   * a request naming the wrong return succeeds against another return's line.
   *
   * Raises the SAME `ReturnLineNotFoundError` a genuinely missing line raises:
   * from the caller's position "this line is not under this return" and "this
   * line does not exist" are the same fact, and distinguishing them would
   * confirm the existence of a line the URL did not correctly address.
   */
  private async assertLineBelongsToReturn(returnId: string, lineId: string): Promise<void> {
    const record = await this.returns.getReturn(returnId);
    if (record === null) {
      throw new ReturnNotFoundError(returnId);
    }
    if (!record.lines.some((line) => line.id === lineId)) {
      throw new ReturnLineNotFoundError(lineId);
    }
  }

  private toCountersDto(line: ReturnLine): ReturnLineCountersDto {
    return {
      id: line.id,
      quantityAdvised: line.quantityAdvised,
      quantityReceived: line.quantityReceived,
      quantityRestocked: line.quantityRestocked,
      quantityScrapped: line.quantityScrapped,
      custodyState: line.custodyState,
      moneyState: line.moneyState,
      disposition: line.disposition,
      receivedAt: line.receivedAt ? line.receivedAt.toISOString() : null,
      disposedAt: line.disposedAt ? line.disposedAt.toISOString() : null,
    };
  }

  private toRestockBlockedDto(
    detail: RestockBlockedDetail | null
  ): RestockBlockedResponseDto | null {
    if (detail === null) {
      return null;
    }
    return {
      eventId: detail.eventId,
      quantity: detail.quantity,
      sku: detail.sku,
      reason: detail.reason,
      detail: detail.detail,
      connectionId: detail.connectionId,
      connectionName: detail.connectionName,
      state: detail.state,
    };
  }

  private toProposalDto(
    result: ReturnCorrectionProposalResult
  ): ReturnCorrectionProposalResponseDto {
    return {
      outcome: result.outcome,
      changeId: result.changeId,
      opened: result.opened,
      proposal:
        result.proposal === null
          ? null
          : {
              returnId: result.proposal.returnId,
              internalOrderId: result.proposal.internalOrderId,
              invoiceRecordId: result.proposal.invoiceRecordId,
              invoiceConnectionId: result.proposal.invoiceConnectionId,
              invoiceDocumentNumber: result.proposal.invoiceDocumentNumber,
              currency: result.proposal.currency,
              lines: result.proposal.lines.map((line) => ({
                returnLineId: line.returnLineId,
                lineIndex: line.lineIndex,
                name: line.name,
                sku: line.sku,
                quantityDisposed: line.quantityDisposed,
                status: line.status,
                candidates: line.candidates.map((candidate) => ({ ...candidate })),
                selectedOriginalLineNumber: line.selectedOriginalLineNumber,
                newQuantity: line.newQuantity,
                noMatchReason: line.noMatchReason,
                // Resolved from the ONE core helper, never re-authored here —
                // two copies of this copy would drift on the first reword.
                noMatchExplanation:
                  line.noMatchReason === null
                    ? null
                    : describeCorrectionNoMatchReason(line.noMatchReason),
                candidatesPriceOrRateDiffer: line.candidatesPriceOrRateDiffer,
              })),
            },
    };
  }
}
