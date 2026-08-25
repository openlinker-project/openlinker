/**
 * Returns Service
 *
 * The `returns` context's application service (#2328, ADR-060): ingestion's
 * idempotent update-or-create, plus the two thin reads that keep
 * `RETURN_REPOSITORY_TOKEN` inside this context.
 *
 * ## What this service decides, and what it refuses to
 *
 * It maps the neutral `IncomingReturn` projection (#2329) onto the OL-owned
 * aggregate. Three of those mappings are decisions rather than field copies:
 *
 *  - **The reason vocabulary is narrowed here, not adapter-side.** A source's
 *    `reasonRaw` is open-world by contract; mapping it onto `RefundReason` is
 *    core's call, made through the one shared `return-reason.mapper` so the
 *    repository's read path and this write path cannot drift apart.
 *  - **Attribution is a LOOKUP, never a mint.** See `resolveInternalOrderId`.
 *  - **A missing key is refused, never invented.** See
 *    `ReturnObservationMissingExternalIdError`.
 *
 * It deliberately does NOT: emit an event (nothing in this wave subscribes to
 * one, and a contract with no subscriber is a liability), take a lock (the
 * write is a single atomic transaction whose conflict resolution is the
 * database's), resolve line-level order attribution (`order_records` has no
 * lines table to point at), or touch any Wave-2 custody/money/disposition
 * column.
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { ReturnNotAttributedError } from '../../domain/exceptions/return-not-attributed.error';
import { ReturnNotFoundError } from '../../domain/exceptions/return-not-found.error';
import { ReturnObservationMissingExternalIdError } from '../../domain/exceptions/return-observation-missing-external-id.error';
import { toRefundReasonOrOther } from '../../domain/return-reason.mapper';
import type { ReturnRecord } from '../../domain/entities/return-record.entity';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type {
  IncomingReturn,
  IncomingReturnLine,
} from '../../domain/types/incoming-return.types';
import type { ReturnDownstreamTrigger } from '../../domain/types/return-trigger.types';
import type { UpsertReturnLineInput } from '../../domain/types/return-upsert.types';
import { RETURN_REPOSITORY_TOKEN } from '../../returns.tokens';
import type {
  IReturnsService,
  UpsertReturnObservationResult,
} from './returns.service.interface';

@Injectable()
export class ReturnsService implements IReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService
  ) {}

  async upsertFromObservation(
    sourceConnectionId: string,
    observation: IncomingReturn
  ): Promise<UpsertReturnObservationResult> {
    const externalReturnId = observation.externalReturnId?.trim() ?? '';
    if (externalReturnId.length === 0) {
      // Refused BEFORE the repository is touched. The unique index is partial,
      // so a null/blank key has no conflict target and every re-sync would
      // insert another copy of the same return — silently, and forever.
      // Synthesising a stable key is the adapter's job; core will not guess one.
      throw new ReturnObservationMissingExternalIdError(
        sourceConnectionId,
        observation.externalOrderId
      );
    }

    const internalOrderId = await this.resolveInternalOrderId(sourceConnectionId, observation);

    const { record } = await this.repository.upsertFromSource({
      sourceConnectionId,
      externalReturnId,
      internalOrderId,
      externalOrderId: observation.externalOrderId,
      origin: 'source_ingested',
      rawStatus: observation.rawStatus,
      rawPayload: this.buildRawPayload(observation),
      openedAt: this.parseOpenedAt(externalReturnId, observation.createdAt),
      lines: observation.lines.map((line, index) => this.toLineInput(line, index)),
    });

    return { record, attributed: internalOrderId !== null };
  }

  async getReturn(id: string): Promise<ReturnRecord | null> {
    return this.repository.findById(id);
  }

  async listOrphanReturns(limit: number, offset: number): Promise<ReturnRecord[]> {
    return this.repository.listOrphans(limit, offset);
  }

  async countOrphanReturns(): Promise<number> {
    return this.repository.countOrphans();
  }

  /**
   * The downstream-trigger block. See the interface docblock for the three properties
   * that make this a re-read, a return-the-record, and a throw.
   */
  async assertAttributedForTrigger(
    returnId: string,
    trigger: ReturnDownstreamTrigger
  ): Promise<ReturnRecord> {
    const record = await this.repository.findById(returnId);

    if (record === null) {
      throw new ReturnNotFoundError(returnId);
    }

    if (record.isOrphan()) {
      this.logger.warn(
        `Return ${returnId} is orphaned — refusing the "${trigger}" trigger (no attributed order)`
      );
      throw new ReturnNotAttributedError(returnId, trigger);
    }

    return record;
  }

  /**
   * Resolve the source's order id to an OL internal one — a LOOKUP, never a
   * mint.
   *
   * `getInternalId`, never `getOrCreateInternalId`. The get-or-create form is
   * correct on the order-ingestion path because that path goes on to CREATE the
   * order; here it would mint an internal id for an order OL has never
   * ingested, and every downstream trigger would then be pointed at a phantom.
   * An unresolved order is a first-class state: the return persists as an
   * orphan, visibly, and blocks the triggers that need attribution.
   *
   * Note `getInternalId` THROWS when the connection does not resolve — it reads
   * the `Connection` to derive `platformType`. That is left uncaught on purpose:
   * on this path the observing connection exists by construction (the caller
   * pulled the observation through that very connection's adapter), so a throw
   * here means the connection was deleted mid-ingestion, which is a real
   * failure the job should surface rather than a return quietly recorded as an
   * orphan.
   */
  private async resolveInternalOrderId(
    sourceConnectionId: string,
    observation: IncomingReturn
  ): Promise<string | null> {
    if (observation.externalOrderId === null) {
      return null;
    }

    const internalOrderId = await this.identifierMapping.getInternalId(
      CORE_ENTITY_TYPE.Order,
      observation.externalOrderId,
      sourceConnectionId
    );

    if (internalOrderId === null) {
      this.logger.debug(
        `Return ${observation.externalReturnId} references order ${observation.externalOrderId} on connection ${sourceConnectionId}, which OL has not ingested — persisting as an orphan`
      );
    }

    return internalOrderId;
  }

  /**
   * Everything the source told us that has no column of its own.
   *
   * `IncomingReturn` is deliberately richer than the `returns` table:
   * `referenceNumber`, `isTerminalAtSource`, `buyerEmail` and `marketplaceId`
   * have no columns, and neither do the line-level `unitPrice`,
   * `serialNumbers` and `raw` (there is no per-line jsonb). Rather than drop
   * them — which would make the stored payload a lie by omission the first time
   * someone debugged against it — they ride in the header's `rawPayload`
   * alongside the source's own untouched `raw`.
   *
   * Nothing in core branches on any of it. In particular `isTerminalAtSource`
   * is stored and never read: it bounds a sweep (#2330) and must never drive an
   * OL lifecycle, since a terminal source status is not an OL disposition.
   *
   * The known PII gap is inherited, not introduced: `rawPayload` has no
   * `OL_STORE_PII` parity with `customer_projections`, which #2330 owns —
   * `buyerEmail` is named here so that decision has a concrete field to act on.
   */
  private buildRawPayload(observation: IncomingReturn): Record<string, unknown> | null {
    const payload: Record<string, unknown> = {};

    if (observation.raw !== undefined) payload.raw = observation.raw;
    if (observation.referenceNumber !== undefined)
      payload.referenceNumber = observation.referenceNumber;
    if (observation.isTerminalAtSource !== undefined)
      payload.isTerminalAtSource = observation.isTerminalAtSource;
    if (observation.buyerEmail !== undefined) payload.buyerEmail = observation.buyerEmail;
    if (observation.marketplaceId !== undefined) payload.marketplaceId = observation.marketplaceId;

    const lineExtras = observation.lines
      .map((line, index) => {
        const extras: Record<string, unknown> = {};
        if (line.unitPrice !== undefined) extras.unitPrice = line.unitPrice;
        if (line.serialNumbers !== undefined) extras.serialNumbers = line.serialNumbers;
        if (line.raw !== undefined) extras.raw = line.raw;
        return Object.keys(extras).length === 0 ? null : { lineIndex: index, ...extras };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (lineExtras.length > 0) payload.lines = lineExtras;

    // `null` rather than `{}` so "the source told us nothing extra" and "we
    // stored an empty document" are the same thing in the column.
    return Object.keys(payload).length === 0 ? null : payload;
  }

  /**
   * The source's `createdAt` becomes `openedAt` — the fact that the return was
   * opened, which is exactly what a source's creation timestamp reports.
   *
   * An unparseable value degrades to `null` with a warning rather than throwing:
   * the return is real and the parcel is coming regardless of whether the source
   * formatted its timestamp correctly, and `openedAt` is COALESCE-applied so a
   * later, well-formed observation can still fill it in.
   */
  private parseOpenedAt(externalReturnId: string, createdAt: string): Date | null {
    const parsed = new Date(createdAt);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.warn(
        `Return ${externalReturnId} carries an unparseable createdAt "${createdAt}" — persisting openedAt as null`
      );
      return null;
    }
    return parsed;
  }

  /**
   * `lineIndex` is the position in the source's own array — the same rule the
   * adapter uses when it stringifies a positional line id, and the reason the
   * line conflict key works at all. Reordering the source array therefore
   * re-keys the lines; no source in scope reorders, and no stabler coordinate
   * exists for a source that identifies lines only positionally.
   */
  private toLineInput(line: IncomingReturnLine, index: number): UpsertReturnLineInput {
    return {
      lineIndex: index,
      externalLineId: line.externalLineId ?? null,
      offerId: line.offerId ?? null,
      sku: line.sku ?? null,
      name: line.name ?? null,
      reason: toRefundReasonOrOther(line.reasonRaw),
      quantityAdvised: line.quantity,
      note: null,
    };
  }
}
