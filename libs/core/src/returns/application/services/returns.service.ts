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
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type AdapterMetadata,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import { ReturnMatchRefusedError } from '../../domain/exceptions/return-match-refused.error';
import { ReturnNotAttributedError } from '../../domain/exceptions/return-not-attributed.error';
import { ReturnRecordRefusedError } from '../../domain/exceptions/return-record-refused.error';
import { ReturnNotFoundError } from '../../domain/exceptions/return-not-found.error';
import { ReturnObservationMissingExternalIdError } from '../../domain/exceptions/return-observation-missing-external-id.error';
import { toRefundReasonOrOther } from '../../domain/return-reason.mapper';
import type { ReturnRecord } from '../../domain/entities/return-record.entity';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type { IncomingReturn, IncomingReturnLine } from '../../domain/types/incoming-return.types';
import type { ReturnDownstreamTrigger } from '../../domain/types/return-trigger.types';
import type {
  ReturnBucketCounts,
  ReturnDeclineAvailability,
  ReturnIngestionAvailability,
  ReturnListFilter,
  ReturnStageCounts,
} from '../../domain/types/return-query.types';
import type { UpsertReturnLineInput } from '../../domain/types/return-upsert.types';
import { RETURN_REPOSITORY_TOKEN } from '../../returns.tokens';
import type {
  IReturnsService,
  MatchOrphanToOrderInput,
  RecordReturnInput,
  UpsertReturnObservationResult,
} from './returns.service.interface';

/**
 * The two advertised-without-dispatch sub-capability names this service reads
 * off an adapter MANIFEST (#2334).
 *
 * Deliberately string literals rather than members of `CoreCapabilityValues`:
 * neither is dispatchable, both are declared in `supportedCapabilities` purely
 * so the host can discover them, and adding them to the core capability union
 * would invite a `getCapabilityAdapter(id, 'ReturnDecliner')` call that passes
 * the manifest gate and then fails inside `dispatchCapability`. They are read
 * here, never resolved.
 */
const RETURN_SOURCE_READER_CAPABILITY = 'ReturnSourceReader';
const RETURN_DECLINER_CAPABILITY = 'ReturnDecliner';

@Injectable()
export class ReturnsService implements IReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    // #2334's two read-only capability questions. `ReturnsModule` already
    // imports `IntegrationsModule` for the #2330 ingestion services, so this is
    // a new CONSTRUCTOR dependency but no new module edge — and it is used only
    // for metadata reads, never to construct an adapter.
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
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

  async listReturns(
    filter: ReturnListFilter,
    limit: number,
    offset: number
  ): Promise<ReturnRecord[]> {
    return this.repository.listReturns(filter, limit, offset);
  }

  async countReturnsByBucket(filter: ReturnListFilter): Promise<ReturnBucketCounts> {
    return this.repository.countReturnsByBucket(filter);
  }

  async countReturnsByStage(filter: ReturnListFilter): Promise<ReturnStageCounts> {
    return this.repository.countReturnsByStage(filter);
  }

  /**
   * Manifest-first, adapter-free (#2334). See `ReturnIngestionAvailability`.
   *
   * `lazy: true` is what makes this free: the entry's `adapter` becomes a
   * memoized construction promise that is never awaited here, so no credential
   * is resolved and no network is touched, while `metadata` — the only field
   * read — is returned eagerly. `includeAllStatuses: true` for the
   * `analytics-trust` reason: a connection sitting in `needs_reauth` is
   * precisely one the operator needs told about, not one to quietly omit from
   * an "is anything configured?" answer.
   *
   * Nothing is caught. A failure here means the integrations registry could not
   * answer, which is not evidence that the operator has configured nothing.
   */
  async getReturnIngestionAvailability(): Promise<ReturnIngestionAvailability> {
    const entries = await this.integrationsService.listCapabilityAdapters<unknown>({
      capability: 'OrderSource',
      lazy: true,
      includeAllStatuses: true,
    });

    const connectionIds = entries
      .filter((entry) =>
        entry.metadata.supportedCapabilities.includes(RETURN_SOURCE_READER_CAPABILITY)
      )
      .map((entry) => entry.connectionId);

    return { configured: connectionIds.length > 0, connectionIds };
  }

  /**
   * The two decline refusals that are knowable without asking the source
   * (#2334). See `ReturnDeclineAvailability` for the unknown-is-not-a-no rule.
   *
   * The record check comes first and mirrors `ReturnDeclineService`'s own
   * `requireExternalReturnId` — same trimmed-empty test, so the disabled button
   * and the 400 cannot disagree about whether this return has an id to name.
   */
  async getDeclineAvailability(record: ReturnRecord): Promise<ReturnDeclineAvailability> {
    if ((record.externalReturnId?.trim() ?? '') === '') {
      return { supported: false, reason: 'no-source-return-id' };
    }

    let metadata: AdapterMetadata;
    try {
      const adapter = await this.integrationsService.getAdapter(record.sourceConnectionId);
      metadata = adapter.metadata;
    } catch (error) {
      // Deliberately reported as SUPPORTED. See the type's docblock: a
      // disabled button captioned "this source does not support decline" is a
      // false claim about the operator's configuration with no path back,
      // whereas letting the attempt through costs one request that fails with
      // the specific reason.
      this.logger.warn(
        `Cannot determine decline support for return ${record.id} on connection ${record.sourceConnectionId} — reporting it as available so the attempt can surface the real reason: ${(error as Error).message}`
      );
      return { supported: true, reason: null };
    }

    if (!metadata.supportedCapabilities.includes(RETURN_DECLINER_CAPABILITY)) {
      return { supported: false, reason: 'source-declares-no-decline' };
    }

    return { supported: true, reason: null };
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

  async matchOrphanToOrder(input: MatchOrphanToOrderInput): Promise<ReturnRecord> {
    const record = await this.repository.findById(input.returnId);
    if (record === null) {
      throw new ReturnNotFoundError(input.returnId);
    }

    if (!record.isOrphan()) {
      throw new ReturnMatchRefusedError(record.id, 'already-attributed');
    }

    // Existence through the mapping table, not through `orders` — see the interface
    // docblock. Unscoped by connection on purpose: an order ingested under a
    // DIFFERENT connection is one of the orphan causes this action exists for.
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      input.internalOrderId
    );
    if (mappings.length === 0) {
      this.logger.warn(
        `Refusing to match return ${record.id} to ${input.internalOrderId}: ` +
          `OpenLinker holds no identifier mapping for that order`
      );
      throw new ReturnMatchRefusedError(record.id, 'unknown-order');
    }

    const claimed = await this.repository.claimAttribution(record.id, input.internalOrderId, {
      at: new Date(),
      actorUserId: input.actorUserId,
    });
    if (!claimed) {
      // A concurrent writer (the #2332 reconcile, or a peer operator) filled the
      // column between the read above and this write. From the operator's point of
      // view that is the same fact as the guard's: the return is attributed.
      this.logger.debug(
        `Return ${record.id} was attributed by a concurrent writer before this match`
      );
      throw new ReturnMatchRefusedError(record.id, 'already-attributed');
    }

    this.logger.log(
      `Return ${record.id} matched to order ${input.internalOrderId} by ` +
        `${input.actorUserId ?? 'system'}`
    );

    // Re-read rather than patching the in-memory record: the row is the authority,
    // the same rule `assertAttributedForTrigger` follows.
    const attributed = await this.repository.findById(record.id);
    if (attributed === null) {
      throw new ReturnNotFoundError(record.id);
    }
    return attributed;
  }

  async recordReturn(input: RecordReturnInput): Promise<ReturnRecord> {
    if (input.lines.length === 0) {
      throw new ReturnRecordRefusedError('no-lines');
    }

    const hasInvalidQuantity = input.lines.some(
      (line) => !Number.isInteger(line.quantityAdvised) || line.quantityAdvised <= 0
    );
    if (hasInvalidQuantity) {
      throw new ReturnRecordRefusedError('invalid-quantity');
    }

    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      input.internalOrderId
    );
    if (mappings.length === 0) {
      throw new ReturnRecordRefusedError('unknown-order');
    }

    // The mapping on the NAMED connection is what supplies `externalOrderId`, so
    // the value is a fact OL already holds rather than an operator-typed string —
    // which is also what keeps the row legible to the #2332 reconcile.
    const onConnection = mappings.find(
      (mapping) => mapping.connectionId === input.sourceConnectionId
    );
    if (onConnection === undefined) {
      this.logger.warn(
        `Refusing to record a return for order ${input.internalOrderId} on connection ` +
          `${input.sourceConnectionId}: OpenLinker holds no mapping for that order there`
      );
      throw new ReturnRecordRefusedError('order-not-on-connection');
    }

    const record = await this.repository.create({
      sourceConnectionId: input.sourceConnectionId,
      // NEVER synthesised. An operator-authored return has no source and must not
      // pretend to have one; the partial unique index exists so this is NULL.
      externalReturnId: null,
      internalOrderId: input.internalOrderId,
      externalOrderId: onConnection.externalId,
      origin: 'operator_authored',
      rawStatus: null,
      rawPayload: null,
      // OL's own clock: the operator opened this here, with OL as the sensor.
      openedAt: new Date(),
      // Left NULL deliberately — authorizing is a SECOND act (`return.authorize`).
      authorizedAt: null,
      declinedAt: null,
      closedAt: null,
      lines: input.lines.map((line, index) => ({
        lineIndex: index,
        externalLineId: null,
        resolvedOrderLineId: null,
        offerId: null,
        sku: line.sku,
        name: line.name,
        reason: line.reason,
        quantityAdvised: line.quantityAdvised,
        note: line.note,
      })),
    });

    this.logger.log(
      `Recorded operator-authored return ${record.id} for order ${input.internalOrderId} ` +
        `on connection ${input.sourceConnectionId} (${input.lines.length} line(s), by ` +
        `${input.actorUserId ?? 'system'})`
    );

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
