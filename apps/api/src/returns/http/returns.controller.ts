/**
 * Returns Controller
 *
 * The operator's READ surface over the return aggregate (#2334): the paged list
 * with its filter-chip counts, the per-return detail, and the one deployment
 * fact an empty list needs in order to say something true.
 *
 * Deliberately separate from `ReturnActionsController` (#2333) even though both
 * mount `returns`. They have different auth postures — the decline write is
 * `@Roles('admin', 'operator')`, these reads are not — and a single controller
 * holding both makes that decoration a per-method detail an eye can skip, which
 * is the wrong failure direction for the only return write OpenLinker performs.
 * They also inject different services, so merging would give every read request
 * a decline-service dependency it never uses. Nest composes the two into one
 * `returns` resource and one Swagger tag regardless.
 *
 * Guards are GLOBAL (`auth.module` `APP_GUARD` = `JwtAuthGuard` then
 * `RolesGuard`), so every route here is authenticated; no `returns:*`
 * permission value is introduced (adjudicated on #2336).
 *
 * `ReturnNotFoundError` is thrown as the DOMAIN error and mapped to 404 by the
 * global `ReturnsExceptionFilter` — never as a Nest `NotFoundException`, which
 * would give one state two spellings and let a second caller of the same
 * service answer 500 for what this one explains.
 *
 * @module apps/api/src/returns/http
 */
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_REFUND_SERVICE_TOKEN,
  type IOrderRecordService,
  type IOrderRefundService,
} from '@openlinker/core/orders';
import {
  RETURN_CUSTODY_SERVICE_TOKEN,
  RETURNS_SERVICE_TOKEN,
  ReturnNotFoundError,
  type IReturnCustodyService,
  type IReturnsService,
  type ReturnBucketCounts,
  type ReturnLine,
  type ReturnListFilter,
  type ReturnRecord,
  type ReturnRestockTarget,
} from '@openlinker/core/returns';
import { ListReturnsQueryDto } from '../dto/list-returns-query.dto';
import type {
  ReturnLineResponseDto,
  ReturnCountersDto,
  ReturnListItemResponseDto,
  ReturnRestockTargetDto,
  ReturnRestockBlockDto,
  ReturnRestockAttestationDto,
  ReturnRefundDto,
} from '../dto/return-response.dto';
import {
  PaginatedReturnsResponseDto,
  ReturnIngestionAvailabilityResponseDto,
  ReturnResponseDto,
  ReturnTimelineResponseDto,
} from '../dto/return-response.dto';

/** Kept in step with the `default:` values `ListReturnsQueryDto` documents. */
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PAGE_OFFSET = 0;

@ApiBearerAuth()
@ApiTags('returns')
@Controller('returns')
export class ReturnsController {
  constructor(
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returnsService: IReturnsService,
    @Inject(RETURN_CUSTODY_SERVICE_TOKEN)
    private readonly custody: IReturnCustodyService,
    @Inject(ORDER_REFUND_SERVICE_TOKEN)
    private readonly refunds: IOrderRefundService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List returns',
    description:
      'Paged, newest first. Filterable by source connection, attribution bucket and creation date range. ' +
      'The `counts` aggregate is computed over the same filters with `bucket` REMOVED, so the filter chips ' +
      'always describe one scope; `total` is the bucket-APPLIED count this page paginates against.',
  })
  @ApiResponse({ status: 200, type: PaginatedReturnsResponseDto })
  async listReturns(
    @Query() query: ListReturnsQueryDto
  ): Promise<PaginatedReturnsResponseDto> {
    // The ONLY place the paging defaults are spelled. `ListReturnsQueryDto`
    // documents them for Swagger but does not initialise the fields, so there
    // is no second value here to drift from.
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const offset = query.offset ?? DEFAULT_PAGE_OFFSET;

    // The scope every chip is counted over: the caller's filters WITHOUT the
    // bucket they are currently looking at.
    const scope: ReturnListFilter = {
      sourceConnectionId: query.sourceConnectionId,
      createdFrom: query.createdFrom === undefined ? undefined : new Date(query.createdFrom),
      createdTo: query.createdTo === undefined ? undefined : new Date(query.createdTo),
      // #2378 value filters. `openedAt` is the SOURCE's instant — deliberately
      // not `createdAt`, which is OL's ingestion clock.
      money: query.money,
      reason: query.reason,
      openedFrom: query.openedFrom === undefined ? undefined : new Date(query.openedFrom),
      openedTo: query.openedTo === undefined ? undefined : new Date(query.openedTo),
    };

    // Two count sets, two scopes, and getting this backwards is the single
    // easiest defect in the slice — it is invisible until an operator clicks a
    // chip. The rule (`ReturnBucketCounts` / `ReturnStageCounts`): the count for
    // the dimension you are NOT looking at stays truthful.
    //
    //   bucket counts -> `bucket` removed, `stage` APPLIED
    //   stage  counts -> `stage` removed, `bucket` APPLIED
    //
    // `countReturnsByStage` additionally strips `stage` itself, so the rule
    // survives a caller that forgets it.
    //   bucket counts  -> `bucket` removed, every other filter applied
    //   stage counts   -> `stage` removed, every other filter applied
    //   segment counts -> `segment` removed, every other filter applied
    //
    // Written generically because this comment has been incomplete twice already.
    // Each count reader additionally strips its own dimension, so the rule
    // survives a caller that forgets it.
    const [records, counts, stageCounts, segmentCounts] = await Promise.all([
      this.returnsService.listReturns(
        { ...scope, bucket: query.bucket, stage: query.stage, segment: query.segment },
        limit,
        offset
      ),
      this.returnsService.countReturnsByBucket({
        ...scope,
        stage: query.stage,
        segment: query.segment,
      }),
      this.returnsService.countReturnsByStage({
        ...scope,
        bucket: query.bucket,
        segment: query.segment,
      }),
      this.returnsService.countReturnsBySegment({
        ...scope,
        bucket: query.bucket,
        stage: query.stage,
      }),
    ]);

    return {
      items: records.map((record) => this.toListItemDto(record)),
      // DERIVED, never a third query. The partition is exhaustive, so the
      // bucket-applied total is already one of the counts — and deriving it is
      // what stops the pagination total and the chips drifting apart, which is
      // the same drift the single-scan aggregate exists to prevent one layer
      // down.
      // `counts` is already computed WITH `stage` applied, so this resolves the
      // total for (scope + stage + bucket) unchanged. Deliberately NOT a second
      // arm reading `stageCounts`: those have `stage` REMOVED, so picking from
      // them would report the stage-less total on a stage-filtered page.
      total: this.resolveScopedTotal(counts, query.bucket),
      limit,
      offset,
      counts,
      stageCounts,
      segmentCounts,
    };
  }

  @Get('ingestion-availability')
  @ApiOperation({
    summary: 'Whether any connection can ingest returns',
    description:
      'Lets an empty returns list distinguish "you have no returns" from "nothing in this deployment is ' +
      'configured to fetch returns" — which look identical on screen and mean opposite things. Resolved ' +
      'from adapter MANIFESTS: no adapter is constructed, no credential resolved, no network touched. ' +
      'Fails loudly rather than reporting `configured: false`, because a registry failure is not evidence ' +
      'about the operator\'s configuration.',
  })
  @ApiResponse({ status: 200, type: ReturnIngestionAvailabilityResponseDto })
  async getIngestionAvailability(): Promise<ReturnIngestionAvailabilityResponseDto> {
    // Declared BEFORE `:returnId` on purpose: Nest matches in declaration
    // order, so a parameterised route above this one would swallow the literal
    // path and this endpoint would 404 for itself.
    const availability = await this.returnsService.getReturnIngestionAvailability();

    return {
      configured: availability.configured,
      connectionIds: availability.connectionIds,
    };
  }

  /**
   * The returns half of the ORDER-detail timeline (#2383).
   *
   * **Declared before `:returnId`** — Nest matches in declaration order, and a
   * literal segment placed after a parameter is unreachable.
   *
   * This is where the three sources meet. `ReturnsService` supplies the two the
   * returns context owns (custody acts, and the `opened` / `declined` header
   * columns); the refund entries are composed HERE, because `RefundRecord`
   * belongs to `orders` and `ReturnsModule` excludes `OrdersModule` on purpose
   * (`returns.module.ts` — it pulls in seven siblings that context has no
   * business carrying). This module already holds that edge (#2382), so
   * composing here costs no new coupling anywhere.
   */
  @Get('events')
  @ApiOperation({
    summary: "One order's return activity, oldest first",
    description:
      'Feeds the order-detail timeline so an operator can see that a return happened, and what has ' +
      'been done about it, without leaving for /returns. Returns `[]` for an order with no returns.',
  })
  @ApiResponse({ status: 200, type: ReturnTimelineResponseDto })
  async listReturnEvents(
    @Query('internalOrderId') internalOrderId: string
  ): Promise<ReturnTimelineResponseDto> {
    const { entries: owned, returns } =
      await this.returnsService.listReturnEventsForOrder(internalOrderId);

    // Iterating the CONTEXTS, not the entries: a return that has produced no
    // entry of its own still gets its refund. That case is reachable —
    // `openedAt` is persisted as null when a source reports an unparseable
    // `createdAt` — and deriving the id set from `owned` would drop exactly it.
    const refundEntries = (
      await Promise.all(
        returns.map(async (context) => {
          const records = await this.refunds.getRefundsForReturn(context.returnId);
          return records.map((record) => ({
            id: `refund:${record.id}`,
            source: 'refund' as const,
            kind: 'refund_confirmed',
            occurredAt: record.recordedAt,
            returnId: context.returnId,
            // Taken from the context, never defaulted: a guessed `returnOrigin`
            // would claim a channel opened a return the operator authored.
            externalReturnId: context.externalReturnId,
            returnOrigin: context.returnOrigin,
            sourceConnectionName: context.sourceConnectionName,
            // `RefundRecord` carries no actor column (ADR-056). `executedBy`
            // answers WHAT moved the money, and is reported as itself rather
            // than dressed up as a person.
            actorUserId: null,
            quantity: null,
            restockState: null,
            disposition: null,
            refundExecutedBy: record.executedBy,
            amount: record.amount,
            currency: record.currency,
          }));
        })
      )
    ).flat();

    const entries = [...owned, ...refundEntries]
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .map((entry) => ({ ...entry, occurredAt: entry.occurredAt.toISOString() }));

    return { entries };
  }

  @Get(':returnId')
  @ApiOperation({
    summary: 'Get one return with its lines',
    description:
      "Includes the source's own `rawStatus` verbatim — render it attributed to the source, never " +
      're-labelled into OpenLinker vocabulary — and `declineAvailability`, so the decline action can be ' +
      'disabled with a stated reason rather than silently missing.',
  })
  @ApiResponse({ status: 200, type: ReturnResponseDto })
  @ApiResponse({ status: 404, description: 'No such return' })
  async getReturn(@Param('returnId') returnId: string): Promise<ReturnResponseDto> {
    const record = await this.returnsService.getReturn(returnId);

    if (record === null) {
      throw new ReturnNotFoundError(returnId);
    }

    const declineAvailability = await this.returnsService.getDeclineAvailability(record);
    // The three custody reads the detail renders. Fanned out together: they are
    // independent, and serialising them would add two round trips to a page load
    // for no ordering guarantee.
    const [restockTarget, restockBlocks, restockAttestations, refunds] = await Promise.all([
      this.custody.getRestockTarget(),
      this.custody.listOutstandingRestockBlocks(returnId),
      this.custody.listRestockAttestations(returnId),
      // BY RETURN, never by order: an orphan has no order id to filter by, and
      // an order carrying two returns would cross-attribute each panel with the
      // other's refunds.
      this.refunds.getRefundsForReturn(returnId),
    ]);

    // The order's currency, so the form can lock its input to a real value.
    // `null` on an orphan, which has no order — and the panel must then refuse
    // rather than accept a typed currency, because nothing downstream checks it.
    const orderRecord =
      record.internalOrderId === null
        ? null
        : await this.orderRecords.getOrderRecord(record.internalOrderId);

    return {
      ...this.toListItemDto(record),
      lines: record.lines.map((line) => this.toLineDto(line)),
      declineAvailability,
      restockTarget: ReturnsController.toRestockTargetDto(restockTarget),
      // Disjoint by construction — attesting flips an act out of the blocked
      // set — so a line can appear in at most one of these at a time.
      restockBlocks: restockBlocks.map(
        (block): ReturnRestockBlockDto => ({
          eventId: block.eventId,
          returnLineId: block.returnLineId,
          quantity: block.quantity,
          sku: block.sku,
          reason: block.reason,
          detail: block.detail,
          connectionId: block.connectionId,
          connectionName: block.connectionName,
          state: block.state,
        })
      ),
      refunds: refunds.map(
        (refund): ReturnRefundDto => ({
          id: refund.id,
          amount: refund.amount,
          currency: refund.currency,
          reason: refund.reason,
          note: refund.note,
          recordedAt: refund.recordedAt.toISOString(),
          executedBy: refund.executedBy,
        })
      ),
      orderCurrency: orderRecord?.currency ?? null,
      restockAttestations: restockAttestations.map(
        (attestation): ReturnRestockAttestationDto => ({
          eventId: attestation.eventId,
          returnLineId: attestation.returnLineId,
          quantity: attestation.quantity,
          actorUserId: attestation.actorUserId,
          occurredAt: attestation.occurredAt.toISOString(),
          note: attestation.note,
        })
      ),
    };
  }

  /**
   * Flatten the domain union onto the wire.
   *
   * Every arm-specific field is independently nullable and `null` means *not
   * reported for this status*, never a value — the same rule the commercial
   * snapshot (#2024) holds to. A client branches on `status`, never on the
   * presence of a name.
   */
  private static toRestockTargetDto(target: ReturnRestockTarget): ReturnRestockTargetDto {
    return {
      status: target.status,
      connectionId: target.status === 'resolved' ? target.connectionId : null,
      connectionName: target.status === 'resolved' ? target.connectionName : null,
      candidateCount:
        target.status === 'ambiguous-inventory-master' ? target.candidateCount : null,
    };
  }

  /**
   * Which count this request's page paginates against.
   *
   * With no bucket the scope IS the whole set; with one, the partition already
   * holds that side's count.
   */
  private resolveScopedTotal(
    counts: ReturnBucketCounts,
    bucket: ReturnListFilter['bucket']
  ): number {
    if (bucket === 'orphan') return counts.orphan;
    if (bucket === 'attributed') return counts.attributed;
    return counts.total;
  }

  /**
   * The header allowlist. `rawPayload` is absent and must stay absent — see the
   * DTO module docblock.
   *
   * `bucket` comes from `record.isOrphan()`, the entity's single definition of
   * orphan; spelling `internalOrderId === null` here would be the second one.
   */
  private toListItemDto(record: ReturnRecord): ReturnListItemResponseDto {
    return {
      id: record.id,
      sourceConnectionId: record.sourceConnectionId,
      externalReturnId: record.externalReturnId,
      internalOrderId: record.internalOrderId,
      externalOrderId: record.externalOrderId,
      origin: record.origin,
      bucket: record.isOrphan() ? 'orphan' : 'attributed',
      rawStatus: record.rawStatus,
      openedAt: this.toIso(record.openedAt),
      authorizedAt: this.toIso(record.authorizedAt),
      declinedAt: this.toIso(record.declinedAt),
      closedAt: this.toIso(record.closedAt),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      counters: this.toCountersDto(record),
      // Passed through verbatim, including `null`. Defaulting to `false` here
      // would turn "this read did not report it" into "your stock is fine".
      restockBlocked: record.restockBlocked,
    };
  }

  /**
   * The counter rollup, from whichever source this read actually has (#2377).
   *
   * `ReturnRecord.counters` is `null` on the DETAIL read — that read carries
   * real `lines`, so it folds them here rather than being handed an aggregate it
   * did not need. The LIST read carries the SQL aggregate and no lines. Both
   * paths must produce the same six numbers, because both feed the same
   * `deriveReturnStage` in the browser and a stage that changed when an operator
   * opened a row would be worse than no stage at all.
   *
   * `null` is never read as zeroes: the fallback folds lines, and a return with
   * neither is genuinely zero.
   */
  private toCountersDto(record: ReturnRecord): ReturnCountersDto {
    if (record.counters !== null) {
      return record.counters;
    }

    return record.lines.reduce<ReturnCountersDto>(
      (acc, line) => {
        const writtenOff = line.custodyState === 'not_returned';
        return {
          lineCount: acc.lineCount + 1,
          notReturnedLineCount: acc.notReturnedLineCount + (writtenOff ? 1 : 0),
          quantityAdvised: acc.quantityAdvised + line.quantityAdvised,
          notReturnedQuantityAdvised:
            acc.notReturnedQuantityAdvised + (writtenOff ? line.quantityAdvised : 0),
          quantityReceived: acc.quantityReceived + line.quantityReceived,
          quantityRestocked: acc.quantityRestocked + line.quantityRestocked,
          quantityScrapped: acc.quantityScrapped + line.quantityScrapped,
        };
      },
      {
        lineCount: 0,
        notReturnedLineCount: 0,
        quantityAdvised: 0,
        notReturnedQuantityAdvised: 0,
        quantityReceived: 0,
        quantityRestocked: 0,
        quantityScrapped: 0,
      }
    );
  }

  private toLineDto(line: ReturnLine): ReturnLineResponseDto {
    return {
      id: line.id,
      lineIndex: line.lineIndex,
      externalLineId: line.externalLineId,
      resolvedOrderLineId: line.resolvedOrderLineId,
      offerId: line.offerId,
      sku: line.sku,
      name: line.name,
      reason: line.reason,
      quantityAdvised: line.quantityAdvised,
      quantityReceived: line.quantityReceived,
      quantityRestocked: line.quantityRestocked,
      quantityScrapped: line.quantityScrapped,
      custodyState: line.custodyState,
      moneyState: line.moneyState,
      disposition: line.disposition,
      receivedAt: this.toIso(line.receivedAt),
      disposedAt: this.toIso(line.disposedAt),
      note: line.note,
    };
  }

  /** A null date stays null — never an empty string, never a substituted now. */
  private toIso(value: Date | null): string | null {
    return value === null ? null : value.toISOString();
  }
}
