/**
 * Return Custody Service (#2370, `W2-33`, ADR-060)
 *
 * The two operator write paths on a return line — receive and dispose — plus the
 * attestation that resolves a refused restock. This is what finally drives the
 * counters and the custody column Wave 1c shipped defaulted and undriven, and it
 * is the first production caller of `InventoryMasterPort.adjustInventory`.
 *
 * ## Four rules this file exists to hold
 *
 * **1. A blocked restock is a recorded disposition whose counter does not move.**
 * The act is persisted and never rolled back — the goods really were disposed
 * of — but `quantityRestocked` stays put and the units remain counted in
 * `quantityReceived`, because the master's book did not take them (spec § 5.4).
 * That is why `applyReturnCustodyDisposition` runs AFTER the master answers and
 * never on the blocked branch, and it is why #2367 needed no amendment.
 *
 * **2. The counter check runs BEFORE the boundary crossing.** The pure
 * transition is called twice: once as validation (outcome discarded) so an
 * illegal disposition is refused without touching the master, and once at settle
 * time against the locked row for the authoritative counters. It is pure, so the
 * second call is free — and calling it only once, at the end, would mean an
 * over-disposition increments the master's book and is refused afterwards.
 *
 * **3. Disposal is serialized per line.** The validation above is a read, and a
 * read-then-act guard across a provider boundary is precisely the shape ADR-041
 * §3a serializes with `invoiceIssueLockKey` — see `return-custody-lock.ts`.
 *
 * **4. An orphan restocks nothing.** The restock path asserts attribution
 * through the ONE #2332 seam rather than spelling its own `internalOrderId`
 * check. Receiving and scrapping do not: neither moves goods, money or paperwork
 * outside OL's own building.
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnCustodyService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { InventoryAdjustmentResult, InventoryMasterPort } from '@openlinker/core/inventory';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import {
  applyReturnCustodyDisposition,
  applyReturnCustodyReceipt,
  markReturnCustodyNotReturned,
} from '../../domain/domain-services/return-custody-transitions.domain-service';
import {
  blockedBeforeMaster,
  classifyRestockFailure,
  classifyRestockSuccess,
  type RestockOutcome,
} from '../../domain/domain-services/restock-outcome.domain-service';
import type { ReturnLine } from '../../domain/entities/return-line.entity';
import type { ReturnRecord } from '../../domain/entities/return-record.entity';
import type { ReturnLineEvent } from '../../domain/entities/return-line-event.entity';
import { ReturnCustodyContendedError } from '../../domain/exceptions/return-custody-contended.error';
import { ReturnLineNotFoundError } from '../../domain/exceptions/return-line-not-found.error';
import { ReturnRestockAttestationInvalidError } from '../../domain/exceptions/return-restock-attestation-invalid.error';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type { ReturnDisposition } from '../../domain/types/return-line.types';
import { RETURN_REPOSITORY_TOKEN, RETURNS_SERVICE_TOKEN } from '../../returns.tokens';
import { IReturnsService } from './returns.service.interface';
import {
  RETURN_CUSTODY_LOCK_TTL_MS,
  returnCustodyLockKey,
} from './return-custody-lock';
import type {
  AttestStockResult,
  DisposeLineInput,
  DisposeLineResult,
  IReturnCustodyService,
  MarkNotReturnedInput,
  MarkNotReturnedResult,
  ReceiveLineInput,
  ReceiveLineResult,
  RestockBlockedDetail,
  ReturnRestockTarget,
} from './return-custody.service.interface';

@Injectable()
export class ReturnCustodyService implements IReturnCustodyService {
  private readonly logger = new Logger(ReturnCustodyService.name);

  constructor(
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returns: IReturnsService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort
  ) {}

  async receiveLine(lineId: string, input: ReceiveLineInput): Promise<ReceiveLineResult> {
    const at = new Date();

    const { event } = await this.repository.runLineWrite(lineId, ({ line }) => {
      // Computed from the LOCKED row, so a concurrent receipt cannot be lost.
      const outcome = applyReturnCustodyReceipt(line, { quantity: input.quantity, at });

      return {
        event: {
          returnId: line.returnId,
          returnLineId: line.id,
          kind: 'receive' as const,
          quantity: input.quantity,
          disposition: null,
          // A receipt never had a book write to make.
          restockState: 'not_applicable' as const,
          restockBlockedReason: null,
          restockBlockedDetail: null,
          restockedBy: null,
          masterConnectionId: null,
          note: input.note ?? null,
          actorUserId: input.actorUserId ?? null,
          occurredAt: at,
          attestedByEventId: null,
        },
        outcome,
        disposition: null,
        result: null,
      };
    });

    return { line: await this.requireLine(lineId), event };
  }

  async markLineNotReturned(
    lineId: string,
    input: MarkNotReturnedInput
  ): Promise<MarkNotReturnedResult> {
    const at = new Date();

    const { event } = await this.repository.runLineWrite(lineId, ({ line }) => {
      // Computed from the LOCKED row: a receipt landing between an unlocked
      // read and this write is exactly the case the rule refuses, and reading
      // it here is what makes that refusal reliable rather than advisory.
      const outcome = markReturnCustodyNotReturned(line);

      return {
        event: {
          returnId: line.returnId,
          returnLineId: line.id,
          kind: 'not_returned' as const,
          // The shortfall — and with nothing received (the rule's own
          // precondition) that is the whole advised quantity. The rule refuses
          // a zero-advised line, which is what keeps this above the
          // `CHK_return_line_events_quantity_positive` floor.
          quantity: line.quantityAdvised - line.quantityReceived,
          disposition: null,
          // Writing a line off changes no stock: there is no book write to make.
          restockState: 'not_applicable' as const,
          restockBlockedReason: null,
          restockBlockedDetail: null,
          restockedBy: null,
          masterConnectionId: null,
          note: input.note ?? null,
          actorUserId: input.actorUserId ?? null,
          occurredAt: at,
          attestedByEventId: null,
        },
        outcome,
        disposition: null,
        result: null,
      };
    });

    return { line: await this.requireLine(lineId), event };
  }

  async disposeLine(lineId: string, input: DisposeLineInput): Promise<DisposeLineResult> {
    const at = new Date();
    const { line, record } = await this.requireLineWithRecord(lineId);

    if (input.disposition === 'scrap') {
      // Nothing leaves OL, so no lock, no master, one transaction.
      return this.disposeScrap(line.id, input, at);
    }

    // An orphan restocks nothing (#2332). Asserted through the ONE seam, before
    // anything is written — a restock against a phantom order moves real stock
    // and no later log line recovers it.
    await this.returns.assertAttributedForTrigger(record.id, 'restock');

    const token = await this.lock.acquire(
      returnCustodyLockKey(lineId),
      RETURN_CUSTODY_LOCK_TTL_MS
    );
    if (token === null) {
      // Refused before the adapter is reached, and retryable — see the error.
      throw new ReturnCustodyContendedError(lineId);
    }

    try {
      return await this.disposeRestock(lineId, input, at);
    } finally {
      await this.lock.release(returnCustodyLockKey(lineId), token);
    }
  }

  async markStockHandledManually(
    lineId: string,
    input: { actorUserId?: string | null; note?: string | null }
  ): Promise<AttestStockResult> {
    const at = new Date();
    const outstanding = await this.repository.findOutstandingRestockEvents(lineId);

    if (outstanding.length === 0) {
      // Refused rather than a silent no-op: the attestation MOVES UNITS, so
      // succeeding without changing anything teaches an operator to distrust it.
      throw new ReturnRestockAttestationInvalidError(lineId);
    }

    const events: ReturnLineEvent[] = [];

    // One write per resolved act, each against a freshly locked row — the
    // counters accumulate, so they must not be computed from one stale read.
    for (const blocked of outstanding) {
      const { event } = await this.repository.runLineWrite(lineId, ({ line }) => {
        const outcome = applyReturnCustodyDisposition(line, {
          quantity: blocked.quantity,
          disposition: 'restock',
          at,
        });

        return {
          event: {
            returnId: line.returnId,
            returnLineId: line.id,
            kind: 'stock_attestation' as const,
            quantity: blocked.quantity,
            disposition: 'restock' as ReturnDisposition,
            restockState: 'handled_manually' as const,
            restockBlockedReason: null,
            restockBlockedDetail: null,
            // The honesty device: a human did it, OL did not write the stock.
            restockedBy: 'operator_out_of_band' as const,
            // The operator's own act, made against no master by definition.
            masterConnectionId: null,
            note: input.note ?? null,
            actorUserId: input.actorUserId ?? null,
            occurredAt: at,
            attestedByEventId: blocked.id,
          },
          outcome,
          disposition: 'restock' as ReturnDisposition,
          result: null,
        };
      });

      // The blocked act keeps its own state and its reason forever — spec § 5.4:
      // the record is permanent, only the ATTENTION clears. Clearing the block
      // is what `attestedByEventId` above expresses; the outstanding read is
      // narrowed by it below.
      await this.repository.settleLineRestock(
        blocked.id,
        lineId,
        {
          restockState: 'handled_manually',
          restockBlockedReason: blocked.restockBlockedReason,
          restockBlockedDetail: blocked.restockBlockedDetail,
          restockedBy: 'operator_out_of_band',
        },
        // The counters already moved in the `runLineWrite` above; this settle
        // only retires the blocked act.
        () => null,
        null
      );

      events.push(event);
    }

    this.logger.log(
      `Return line ${lineId}: operator attested ${events.length} restock(s) handled out of band — ` +
        'OpenLinker did not write stock'
    );

    return { line: await this.requireLine(lineId), events };
  }

  /**
   * Where a restock would land — resolved WITHOUT constructing an adapter.
   *
   * This is a read on the return-detail page, and it needs only a name, a
   * count and a failure classification; it never calls a method on the master.
   * `listCapabilityAdapters` constructs eagerly by default, and constructing a
   * capability adapter RESOLVES ITS CREDENTIALS (#2229), so reusing the write
   * path's `resolveInventoryMaster` here would build every InventoryMaster
   * connection on every page load of a page that was previously
   * adapter-free. It lists `lazy` instead.
   *
   * **Reported still equals enforced**, because the part that must not drift
   * is the SELECTION RULE, not the listing mode: both callers classify through
   * the one `classifyInventoryMasterCandidates` below, so "which connection"
   * and "when is it ambiguous" have exactly one definition.
   */
  async getRestockTarget(): Promise<ReturnRestockTarget> {
    let candidates: Array<{ connectionId: string; connection: Connection }>;

    try {
      candidates = await this.integrations.listCapabilityAdapters<InventoryMasterPort>({
        capability: 'InventoryMaster',
        lazy: true,
      });
    } catch (error) {
      this.logger.error(
        `Could not resolve an InventoryMaster connection for the restock-target read: ${
          (error as Error).message
        }`
      );
      return { status: 'adapter-unresolved' };
    }

    const classified = ReturnCustodyService.classifyInventoryMasterCandidates(candidates);

    if (classified.kind === 'none') {
      return { status: 'no-inventory-master' };
    }

    if (classified.kind === 'ambiguous') {
      // The same refusal `writeMasterStock` makes, made early enough for the
      // operator to read it before they dispose rather than after.
      return {
        status: 'ambiguous-inventory-master',
        candidateCount: classified.candidateCount,
      };
    }

    return {
      status: 'resolved',
      connectionId: classified.chosen.connectionId,
      connectionName: classified.chosen.connection.name,
    };
  }

  /**
   * The one selection rule: none / exactly one / ambiguous, and WHICH one.
   *
   * Shared by the write path and the operator-facing disclosure so the name an
   * operator is shown and the book a restock writes to cannot disagree. It is
   * generic over the entry shape precisely so a lazy listing (no adapter
   * constructed) and an eager one can both use it.
   */
  private static classifyInventoryMasterCandidates<
    T extends { connectionId: string; connection: Connection },
  >(
    candidates: readonly T[]
  ):
    | { kind: 'none' }
    | { kind: 'one'; chosen: T }
    | { kind: 'ambiguous'; chosen: T; candidateCount: number } {
    if (candidates.length === 0) return { kind: 'none' };
    if (candidates.length > 1) {
      return { kind: 'ambiguous', chosen: candidates[0], candidateCount: candidates.length };
    }
    return { kind: 'one', chosen: candidates[0] };
  }

  async listOutstandingRestockBlocks(returnId: string): Promise<RestockBlockedDetail[]> {
    const events = await this.repository.findOutstandingRestockEventsForReturn(returnId);
    if (events.length === 0) {
      return [];
    }

    const record = await this.returns.getReturn(returnId);
    const skuByLineId = new Map(
      (record?.lines ?? []).map((line) => [line.id, line.sku] as const)
    );

    // Spec § 5.4's remediation copy NAMES the system that refused, so a read
    // that reported `null` here would render "Add 2 x SKU-1 in null yourself".
    // The id is the act's own (persisted at block time, so a later
    // reconfiguration cannot relabel it); the display name is resolved now, so a
    // renamed connection reads correctly and a deleted one degrades to its id
    // rather than to nothing.
    const names = await this.resolveConnectionNames(
      events.map((event) => event.masterConnectionId)
    );

    return events.map((event) => ({
      eventId: event.id,
      quantity: event.quantity,
      sku: skuByLineId.get(event.returnLineId) ?? null,
      reason: event.restockBlockedReason ?? 'unknown',
      detail: event.restockBlockedDetail,
      connectionId: event.masterConnectionId,
      connectionName:
        event.masterConnectionId === null
          ? null
          : names.get(event.masterConnectionId) ?? event.masterConnectionId,
      state: event.restockState,
    }));
  }

  /**
   * Display names for the connections a set of blocks was made against.
   *
   * One lookup per DISTINCT connection, never one per block — a return with ten
   * blocked lines against one master is one read. A connection that no longer
   * resolves is simply absent from the map, and the caller falls back to its id:
   * an operator can still act on that, whereas an empty label tells them nothing.
   */
  private async resolveConnectionNames(
    connectionIds: readonly (string | null)[]
  ): Promise<Map<string, string>> {
    const distinct = [...new Set(connectionIds.filter((id): id is string => id !== null))];
    const names = new Map<string, string>();

    await Promise.all(
      distinct.map(async (connectionId) => {
        try {
          const { connection } = await this.integrations.getAdapter(connectionId);
          names.set(connectionId, connection.name);
        } catch {
          // Deleted or unresolvable — the caller falls back to the id.
        }
      })
    );

    return names;
  }

  /**
   * `scrap` — no master, no lock, one transaction. The units are written off and
   * stock is deliberately not changed (spec § 5.3).
   */
  private async disposeScrap(
    lineId: string,
    input: DisposeLineInput,
    at: Date
  ): Promise<DisposeLineResult> {
    const { event } = await this.repository.runLineWrite(lineId, ({ line }) => {
      const outcome = applyReturnCustodyDisposition(line, {
        quantity: input.quantity,
        disposition: 'scrap',
        at,
      });

      return {
        event: {
          returnId: line.returnId,
          returnLineId: line.id,
          kind: 'dispose' as const,
          quantity: input.quantity,
          disposition: 'scrap' as ReturnDisposition,
          restockState: 'not_applicable' as const,
          restockBlockedReason: null,
          restockBlockedDetail: null,
          restockedBy: null,
          masterConnectionId: null,
          note: input.note ?? null,
          actorUserId: input.actorUserId ?? null,
          occurredAt: at,
          attestedByEventId: null,
        },
        outcome,
        disposition: 'scrap' as ReturnDisposition,
        result: null,
      };
    });

    return { line: await this.requireLine(lineId), event, restockBlocked: null };
  }

  /**
   * `restock` — validate, append the attempt, cross the boundary, settle.
   *
   * The ordering is the ADR-056 attempted-predicate discipline: the act is
   * persisted BEFORE the adapter call, so a process that dies mid-call leaves an
   * `in_doubt` row rather than silence. `in_doubt` never auto-retries — OL does
   * not know whether the units landed, and guessing moves real stock.
   */
  private async disposeRestock(
    lineId: string,
    input: DisposeLineInput,
    at: Date
  ): Promise<DisposeLineResult> {
    const { line } = await this.requireLineWithRecord(lineId);

    // VALIDATION PASS. Pure, so free — and it is what keeps an over-disposition
    // from incrementing the master's book before being refused.
    applyReturnCustodyDisposition(line, {
      quantity: input.quantity,
      disposition: 'restock',
      at,
    });

    const master = await this.resolveInventoryMaster();

    const { event } = await this.repository.runLineWrite(lineId, ({ line: locked }) => {
      // Re-validated against the locked row: the unlocked pass above may have
      // read state a peer has since changed.
      applyReturnCustodyDisposition(locked, {
        quantity: input.quantity,
        disposition: 'restock',
        at,
      });

      return {
        event: {
          returnId: locked.returnId,
          returnLineId: locked.id,
          kind: 'dispose' as const,
          quantity: input.quantity,
          disposition: 'restock' as ReturnDisposition,
          restockState: 'in_doubt' as const,
          restockBlockedReason: null,
          restockBlockedDetail: null,
          restockedBy: null,
          masterConnectionId: 'unavailable' in master ? null : master.connectionId,
          note: input.note ?? null,
          actorUserId: input.actorUserId ?? null,
          occurredAt: at,
          attestedByEventId: null,
        },
        // No counters move yet — the book has not answered.
        outcome: null,
        disposition: null,
        result: null,
      };
    });

    const outcome = await this.writeMasterStock(master, line, input.quantity, event);

    // The counters move ONLY where the master's book took the units — and the
    // move is computed INSIDE the settle transaction, against the locked row.
    // Computing it here, from the read above, would write an absolute
    // `quantityReceived` captured before the master call and silently clobber a
    // `receiveLine` that landed during it (receiving takes no lock, because it
    // crosses no boundary, so the per-line lock does not cover that race).
    const settled = await this.repository.settleLineRestock(
      event.id,
      lineId,
      {
        restockState: outcome.restockState,
        restockBlockedReason: outcome.restockBlockedReason,
        restockBlockedDetail: outcome.restockBlockedDetail,
        restockedBy: outcome.restockedBy,
      },
      (locked) =>
        outcome.countsTowardRestocked
          ? applyReturnCustodyDisposition(locked, {
              quantity: input.quantity,
              disposition: 'restock',
              at,
            })
          : null,
      outcome.countsTowardRestocked ? 'restock' : null
    );

    if (outcome.idempotencyUnsupported) {
      // Not a failure — the write landed. But a retry against this master WILL
      // double-apply, and only the adapter's own admission reveals that.
      this.logger.warn(
        `Return line ${lineId}: the inventory master does not support idempotency keys — ` +
          'a retried restock would double-apply'
      );
    }

    if (!outcome.countsTowardRestocked) {
      this.logger.error(
        `Return line ${lineId}: restock of ${input.quantity} unit(s) did not reach the ` +
          `inventory master (${outcome.restockState}: ${outcome.restockBlockedReason ?? 'unknown'}) — ` +
          'the units remain counted as received and are NOT reported as restocked'
      );
    }

    return {
      line: await this.requireLine(lineId),
      event: settled,
      restockBlocked: outcome.countsTowardRestocked
        ? null
        : {
            eventId: settled.id,
            quantity: input.quantity,
            sku: line.sku,
            reason: outcome.restockBlockedReason ?? 'unknown',
            detail: outcome.restockBlockedDetail,
            connectionId: 'unavailable' in master ? null : master.connectionId,
            connectionName: 'unavailable' in master ? null : master.connection.name,
            state: outcome.restockState,
          },
    };
  }

  /**
   * Cross the boundary, and classify whatever comes back through the ONE seam.
   *
   * The key is `return:{returnId}:{lineId}:{seq}` — deterministic, built from
   * the act's own sequence, never wall-clock (#2368). A retry of the same
   * logical adjustment recomputes the identical key, which is what lets a
   * deduping master recognise it.
   */
  private async writeMasterStock(
    master: ResolvedInventoryMaster | { unavailable: RestockUnavailable },
    line: ReturnLine,
    quantity: number,
    event: ReturnLineEvent
  ): Promise<RestockOutcome> {
    if ('unavailable' in master) {
      return blockedBeforeMaster(
        master.unavailable,
        master.unavailable === 'no-inventory-master'
          ? 'no active connection with the InventoryMaster capability could be resolved'
          : 'the InventoryMaster connection could not be built — check its credentials and status'
      );
    }
    if (master.ambiguous) {
      // Never a silent pick: a wrong pick moves real stock in the wrong book.
      return blockedBeforeMaster(
        'ambiguous-inventory-master',
        `${master.candidateCount} connections claim the InventoryMaster capability; ` +
          'OpenLinker will not guess which book to write to'
      );
    }
    const target = await this.resolveRestockTarget(line);
    if ('blocked' in target) {
      return target.blocked;
    }

    try {
      const result: InventoryAdjustmentResult = await master.adapter.adjustInventory({
        productId: target.productId,
        variantId: target.variantId,
        quantity,
        reason: 'return_restock',
        // Deterministic, never wall-clock (#2368): built from the act's own
        // per-line sequence, so a retry of the same logical adjustment
        // recomputes the identical key and a deduping master recognises it.
        idempotencyKey: `return:${line.returnId}:${line.id}:${event.seq}`,
      });
      return classifyRestockSuccess(result);
    } catch (error) {
      // Catches `unknown`, deliberately — core cannot name a platform exception
      // type, and #2369's cache-outage fail-closed arrives through this door.
      return classifyRestockFailure(error);
    }
  }

  /**
   * Which product/variant do these units go back into?
   *
   * **A return line carries no product id**, and cannot: `resolvedOrderLineId`
   * is a by-value reference INTO the order snapshot's jsonb (there is no order
   * lines table), and nothing in the shipped model populates it yet. The sku is
   * therefore the only usable coordinate, resolved through `IProductsService`.
   *
   * Both failure modes BLOCK rather than guess. A sku OL has never catalogued is
   * a real state — a marketplace can report one, and the parcel still arrived —
   * and a sku matching several variants must not be resolved by picking the
   * first, for the same reason an ambiguous inventory master must not: the wrong
   * variant is real stock in the wrong place, and no later log line recovers it.
   */
  private async resolveRestockTarget(
    line: ReturnLine
  ): Promise<{ productId: string; variantId: string } | { blocked: RestockOutcome }> {
    const sku = line.sku?.trim() ?? '';
    if (sku === '') {
      return {
        blocked: blockedBeforeMaster(
          'unresolved-product',
          'this return line carries no sku, so OpenLinker cannot tell which product to restock'
        ),
      };
    }

    const variants = await this.products.getVariantsBySkus([sku]);
    const matches = variants.filter((variant) => variant.sku === sku);

    if (matches.length === 0) {
      return {
        blocked: blockedBeforeMaster(
          'unresolved-product',
          `no product variant in OpenLinker carries the sku "${sku}"`
        ),
      };
    }
    if (matches.length > 1) {
      return {
        blocked: blockedBeforeMaster(
          'ambiguous-product',
          `${matches.length} product variants carry the sku "${sku}"; ` +
            'OpenLinker will not guess which one the units belong to'
        ),
      };
    }

    return { productId: matches[0].productId, variantId: matches[0].id };
  }

  /**
   * Resolve the single `InventoryMaster` connection, or report why not.
   *
   * `lazy: false` because the adapter is about to be used. A construction
   * failure degrades to `adapter-unresolved` rather than throwing: the
   * disposition has already been decided by an operator, and losing it because a
   * credential expired would be the wrong direction of failure.
   */
  private async resolveInventoryMaster(): Promise<
    ResolvedInventoryMaster | { unavailable: 'no-inventory-master' | 'adapter-unresolved' }
  > {
    try {
      const entries = await this.integrations.listCapabilityAdapters<InventoryMasterPort>({
        capability: 'InventoryMaster',
      });

      // The SAME classifier the operator-facing disclosure uses, so the
      // connection named on the page is the connection written to here.
      const classified = ReturnCustodyService.classifyInventoryMasterCandidates(entries);

      if (classified.kind === 'none') {
        return { unavailable: 'no-inventory-master' };
      }

      return {
        connectionId: classified.chosen.connectionId,
        connection: classified.chosen.connection,
        adapter: classified.chosen.adapter,
        ambiguous: classified.kind === 'ambiguous',
        candidateCount: classified.kind === 'ambiguous' ? classified.candidateCount : 1,
      };
    } catch (error) {
      this.logger.error(
        `Could not resolve an InventoryMaster connection for a return restock: ${
          (error as Error).message
        }`
      );
      // Reported as `adapter-unresolved`, NEVER as `no-inventory-master`: the
      // operator has configured a master, and telling them they have not sends
      // them to fix something that is not broken.
      return { unavailable: 'adapter-unresolved' };
    }
  }

  private async requireLine(lineId: string): Promise<ReturnLine> {
    const found = await this.repository.findLine(lineId);
    if (found === null) {
      throw new ReturnLineNotFoundError(lineId);
    }
    return found.line;
  }

  private async requireLineWithRecord(
    lineId: string
  ): Promise<{ line: ReturnLine; record: ReturnRecord }> {
    const found = await this.repository.findLine(lineId);
    if (found === null) {
      throw new ReturnLineNotFoundError(lineId);
    }
    return found;
  }
}

type RestockUnavailable = 'no-inventory-master' | 'adapter-unresolved';

interface ResolvedInventoryMaster {
  connectionId: string;
  connection: Connection;
  adapter: InventoryMasterPort;
  ambiguous: boolean;
  candidateCount: number;
}
