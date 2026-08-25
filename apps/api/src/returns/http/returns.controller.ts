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
  RETURNS_SERVICE_TOKEN,
  ReturnNotFoundError,
  type IReturnsService,
  type ReturnBucketCounts,
  type ReturnLine,
  type ReturnListFilter,
  type ReturnRecord,
} from '@openlinker/core/returns';
import { ListReturnsQueryDto } from '../dto/list-returns-query.dto';
import type {
  ReturnLineResponseDto,
  ReturnListItemResponseDto,
} from '../dto/return-response.dto';
import {
  PaginatedReturnsResponseDto,
  ReturnIngestionAvailabilityResponseDto,
  ReturnResponseDto,
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
    private readonly returnsService: IReturnsService
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
    };

    const [records, counts] = await Promise.all([
      this.returnsService.listReturns({ ...scope, bucket: query.bucket }, limit, offset),
      this.returnsService.countReturnsByBucket(scope),
    ]);

    return {
      items: records.map((record) => this.toListItemDto(record)),
      // DERIVED, never a third query. The partition is exhaustive, so the
      // bucket-applied total is already one of the counts — and deriving it is
      // what stops the pagination total and the chips drifting apart, which is
      // the same drift the single-scan aggregate exists to prevent one layer
      // down.
      total: this.resolveScopedTotal(counts, query.bucket),
      limit,
      offset,
      counts,
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

    return {
      ...this.toListItemDto(record),
      lines: record.lines.map((line) => this.toLineDto(line)),
      declineAvailability,
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
    };
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
