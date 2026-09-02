/**
 * Reservation Service (#2344, ADR-061 decision 1, ANALYSIS-1032 § 6I)
 *
 * Turns an order's lines into one claim against OpenLinker's own advisory
 * reservation ledger. Everything that could race lives in the repository's
 * guarded statements; what lives HERE is the resolution that has to happen
 * before a claim can name a position at all, plus the two gates that decide
 * whether a line may be claimed:
 *
 * - the **multi-position gate** — a variant resolving to several live positions
 *   is refused loudly rather than guessed at (§ 6I);
 * - the **terminal-state gate** — a line whose reservation was already released,
 *   consumed or expired is never re-held.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IReservationService}
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  INVENTORY_REPOSITORY_TOKEN,
  RESERVATION_REPOSITORY_TOKEN,
} from '../../inventory.tokens';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import { ReservationRepositoryPort } from '../../domain/ports/reservation-repository.port';
import type { Reservation } from '../../domain/entities/reservation.entity';
import type { ReservationClaimInput } from '../../domain/types/reservation.types';
import type { InventoryPositionCandidate } from '../../domain/types/inventory.types';
import {
  readReservationTtlMs,
  resolveReservationExpiry,
} from '../../domain/types/reservation-expiry.types';
import {
  AmbiguousReservationPositionError,
  type AmbiguousReservationPosition,
} from '../../domain/exceptions/ambiguous-reservation-position.error';
import type { IReservationService } from './reservation.service.interface';
import { ReservationNotHeldError } from '../../domain/exceptions/reservation-not-held.error';
import type {
  CloseForOrderInput,
  CloseForOrderResult,
  ReserveForOrderInput,
  ReserveForOrderResult,
  ReserveOrderLineInput,
  SkippedReservationLine,
} from '../types/reservation-service.types';

/** Group key for `(productId, productVariantId)`. ` ` cannot occur in an id. */
function positionKey(productId: string, productVariantId: string | null): string {
  return `${productId} ${productVariantId ?? ''}`;
}

@Injectable()
export class ReservationService implements IReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY_TOKEN)
    private readonly reservations: ReservationRepositoryPort,
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventory: InventoryRepositoryPort
  ) {}

  async reserveForOrder(input: ReserveForOrderInput): Promise<ReserveForOrderResult> {
    // Reject a nonsensical quantity before any storage access, mirroring the
    // repository's own pre-transaction guard: a caller learns about a
    // programming error without a round trip, and no partial work exists.
    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new RangeError(
          `Reservation quantity must be a positive integer (order line ${line.orderLineId} asked for ${line.quantity})`
        );
      }
    }

    if (input.lines.length === 0) {
      return { granted: [], skipped: [] };
    }

    const now = input.now ?? new Date();
    const expiresAt =
      input.expiresAt ?? resolveReservationExpiry(now, readReservationTtlMs(process.env));

    // Independent reads — this sits on the ingestion path, so they overlap.
    const [closedLines, candidatesByKey] = await Promise.all([
      this.readClosedLineIds(input.orderRecordId),
      this.readLivePositions(input.lines),
    ]);

    const claims: ReservationClaimInput[] = [];
    const skipped: SkippedReservationLine[] = [];
    const ambiguities: AmbiguousReservationPosition[] = [];

    for (const line of input.lines) {
      const inventoryItemId = this.resolvePosition(line, candidatesByKey, ambiguities);
      if (inventoryItemId === null) continue;

      if (inventoryItemId === undefined) {
        skipped.push({ orderLineId: line.orderLineId, reason: 'no-position' });
        continue;
      }

      // The terminal-state gate. The idempotency index is partial on
      // `status = 'held'`, so a released / consumed / expired row does NOT block
      // a fresh insert — and ingestion re-runs on every re-poll of an order, so
      // without this a shipped order would mint a new hold on every poll and
      // re-increment the position counter for stock that has already left.
      if (closedLines.has(line.orderLineId)) {
        skipped.push({ orderLineId: line.orderLineId, reason: 'already-closed' });
        continue;
      }

      claims.push({
        orderRecordId: input.orderRecordId,
        orderLineId: line.orderLineId,
        inventoryItemId,
        quantity: line.quantity,
        atpEffect: input.atpEffect,
        expiresAt,
      });
    }

    // Raised ONCE, naming every ambiguous line, and before any claim is issued —
    // so nothing is written, and a caller degrading by dropping those lines needs
    // a single retry rather than a loop.
    if (ambiguities.length > 0) {
      throw new AmbiguousReservationPositionError(ambiguities);
    }

    if (claims.length === 0) {
      return { granted: [], skipped };
    }

    // ONE call with every claimable line. The sort-by-`inventoryItemId` deadlock
    // guarantee, the single transaction and the all-or-nothing rollback are all
    // properties of this one call (§ 6I) — splitting it per line forfeits all
    // three.
    const granted = await this.reservations.claimHeld(claims);
    return { granted, skipped };
  }

  /**
   * Order lines this order has already closed a reservation for.
   *
   * **Keyed on the LINE, deliberately not on `(line, position)`.** A line's
   * position is not stable across the ladder: #2322's pooled-position repair
   * stales a `locationId IS NULL` row once a located one exists for the same
   * variant, and #2320 admits coexisting cross-source positions. So a line
   * `consumed` against position X can legitimately re-resolve to position Y on a
   * later re-poll — and a position-scoped key would match nothing and mint a
   * fresh hold for stock that has already shipped, which is the exact harm this
   * gate exists to prevent. Nothing is lost by the wider key: a line holds
   * against one position at a time, so no legitimate claim is refused by it.
   *
   * Safe as a read-before-write because the state is MONOTONE: `releaseHeld`
   * guards on `status = 'held'` and nothing returns a terminal row to `held`. The
   * only race is a concurrent release landing between this read and the claim,
   * whose outcome is identical to the two operations happening in the other
   * order. This is not the quantity read-then-act the ledger forbids.
   */
  private async readClosedLineIds(orderRecordId: string): Promise<ReadonlySet<string>> {
    const rows: readonly Reservation[] =
      await this.reservations.listByOrderRecordId(orderRecordId);
    const closed = new Set<string>();
    for (const row of rows) {
      if (row.status !== 'held') {
        closed.add(row.orderLineId);
      }
    }
    return closed;
  }

  private async readLivePositions(
    lines: readonly ReserveOrderLineInput[]
  ): Promise<ReadonlyMap<string, InventoryPositionCandidate[]>> {
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const variantIds = [
      ...new Set(
        lines
          .map((line) => line.productVariantId)
          .filter((id): id is string => id !== null && id !== undefined)
      ),
    ];

    const rows = await this.inventory.findLivePositionsByProductIds(productIds, variantIds);

    const byKey = new Map<string, InventoryPositionCandidate[]>();
    for (const row of rows) {
      const key = positionKey(row.productId, row.productVariantId);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(row);
      else byKey.set(key, [row]);
    }
    return byKey;
  }

  /**
   * The position this line should be claimed against.
   *
   * `undefined` — no live position; the caller reports it as skipped.
   * `null`      — ambiguous; the ambiguity was collected and the caller skips it,
   *               because the whole call will raise once every line is examined.
   */
  private resolvePosition(
    line: ReserveOrderLineInput,
    candidatesByKey: ReadonlyMap<string, InventoryPositionCandidate[]>,
    ambiguities: AmbiguousReservationPosition[]
  ): string | null | undefined {
    // An explicit position is passed straight through, UNVALIDATED. The
    // repository's guard discriminates `missing` from `stale` on its failure
    // path and its answer is the accurate one; testing membership of the
    // live-candidate set here would report a stale explicit id as `missing`.
    if (line.inventoryItemId !== undefined) {
      return line.inventoryItemId;
    }

    const candidates =
      candidatesByKey.get(positionKey(line.productId, line.productVariantId)) ?? [];

    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0].inventoryItemId;

    ambiguities.push({
      orderLineId: line.orderLineId,
      productId: line.productId,
      productVariantId: line.productVariantId,
      candidateInventoryItemIds: candidates.map((c) => c.inventoryItemId),
    });
    this.logger.error(
      `Order line ${line.orderLineId} resolves to ${candidates.length} live inventory positions; ` +
        'refusing to guess which one to reserve against'
    );
    return null;
  }

  async closeForOrder(input: CloseForOrderInput): Promise<CloseForOrderResult> {
    const held = await this.reservations.listHeldByOrderRecordId(input.orderRecordId);
    if (held.length === 0) {
      // Not a warning. An order legitimately holds nothing when reservations are
      // disabled, when no line resolved to a live position, or when a peer
      // already consumed it.
      return { closed: 0, alreadyTerminal: 0, failed: 0 };
    }

    let closed = 0;
    let alreadyTerminal = 0;
    let failed = 0;

    for (const reservation of held) {
      try {
        // Terminal status as DATA (§ 6I) — release, consume and expire decrement
        // identically, so this adds no repository method.
        await this.reservations.releaseHeld({
          orderRecordId: reservation.orderRecordId,
          orderLineId: reservation.orderLineId,
          inventoryItemId: reservation.inventoryItemId,
          terminalStatus: input.terminalStatus,
        });
        closed += 1;
      } catch (error) {
        if (error instanceof ReservationNotHeldError) {
          // Expected race, not a fault: the row left `held` between the read
          // above and this write. The guarded UPDATE is what makes that safe —
          // nothing was double-decremented.
          alreadyTerminal += 1;
          continue;
        }
        // Per-row, never fatal: one bad row must not abort a call that can still
        // correctly close the rest of the order.
        failed += 1;
        this.logger.error(
          `reservation_close_row_failed status=${input.terminalStatus} ` +
            `order=${reservation.orderRecordId} ` +
            `line=${reservation.orderLineId} position=${reservation.inventoryItemId}`,
          (error as Error).stack
        );
      }
    }

    return { closed, alreadyTerminal, failed };
  }
}
