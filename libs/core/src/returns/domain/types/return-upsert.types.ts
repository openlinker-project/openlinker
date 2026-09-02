/**
 * Return Upsert Types
 *
 * The input and result shapes of the idempotent update-or-create keyed
 * `(sourceConnectionId, externalReturnId)` (#2328, ADR-060,
 * `DESIGN-oms-authority-model.md` § 7.3).
 *
 * These are deliberately NOT `CreateReturnRecordInput` with a different name.
 * Two differences are load-bearing, and each encodes a ruling rather than a
 * preference:
 *
 *  1. **`externalReturnId` is NON-NULL here** while the column and the create
 *     input keep it nullable. A NULL key identifies nothing, and the unique
 *     index is partial (`WHERE "externalReturnId" IS NOT NULL`) precisely so a
 *     source that mints no id can hold many rows — which means a NULL-keyed
 *     upsert has NO conflict target and would duplicate the return on every
 *     re-sync, unbounded. The type carries the ruling so the refusal cannot be
 *     forgotten at a call site. NULL stays legal in the MODEL for an
 *     `operator_authored` return, which is created through `create()` and never
 *     ingested.
 *  2. **The three OL-owned timestamps are ABSENT** — `authorizedAt`,
 *     `declinedAt` and `closedAt` are facts about what the OPERATOR decided, so
 *     no source-driven write may set or clear them. Omitting them from the type
 *     is what makes that structural rather than a comment; each gets its own
 *     narrow writer later (#2333 for decline).
 *
 * @module domain/types
 */
import type { RefundReason } from '@openlinker/core/orders/types';
import type { ReturnRecord } from '../entities/return-record.entity';
import type { ReturnOrigin } from './return.types';

/**
 * One line of an upserted return, keyed within the header by `lineIndex`.
 *
 * Every Wave-2 column is absent by construction: the four counters (beyond
 * `quantityAdvised`, which is what the SOURCE advises), `custodyState`,
 * `moneyState`, `disposition`, `receivedAt`, `disposedAt` and
 * `resolvedOrderLineId`. A source cannot know whether a parcel arrived at the
 * operator's building, so re-ingestion must never be able to say it did not.
 */
export interface UpsertReturnLineInput {
  /** Positional index within the source's own line list — half the conflict key. */
  lineIndex: number;
  externalLineId: string | null;
  /** Best-effort source provenance, never authority. */
  offerId: string | null;
  sku: string | null;
  name: string | null;
  reason: RefundReason;
  quantityAdvised: number;
  note: string | null;
}

/**
 * One return header to upsert, plus the full set of lines the source reports.
 */
export interface UpsertReturnRecordInput {
  sourceConnectionId: string;
  /**
   * **Non-null by contract** — see the module docblock. For a source that mints
   * no return id, the ADAPTER synthesises one; core refuses rather than
   * inventing a key it cannot make source-stable.
   */
  externalReturnId: string;
  /**
   * The attributed order, or `null` when OL could not name one. Applied
   * MONOTONICALLY: a later write may fill it in, never blank it back out.
   */
  internalOrderId: string | null;
  /**
   * The source's own order reference (#2332) — the re-attribution key.
   *
   * Applied with COALESCE like `openedAt`, NOT latest-wins like `rawStatus`: a source
   * that stops naming the order has not made the return belong to a different one, and
   * blanking the value would destroy the only thing a later reconcile can resolve from.
   */
  externalOrderId: string | null;
  /** Insert-only — `operator_authored` is never demoted by a later ingestion. */
  origin: ReturnOrigin;
  rawStatus: string | null;
  rawPayload: Record<string, unknown> | null;
  /**
   * When the source opened the return. Applied with COALESCE: it happened once,
   * so a later write that omits it must not erase it.
   */
  openedAt: Date | null;
  lines: UpsertReturnLineInput[];
}

/**
 * What an upsert reports back.
 *
 * **There is no `created` flag, deliberately.** `ON CONFLICT ... DO UPDATE`
 * always produces a row, and distinguishing insert from update would need
 * `xmax = 0` — an MVCC internal with no precedent anywhere in this tree and
 * fragile semantics under concurrent access. Nothing in this slice branches on
 * it; the property that actually matters — "a replay leaves ONE row" — is a
 * claim about the table, and is asserted by counting rows.
 *
 * The returned `record` reports `authorizedAt` / `declinedAt` / `closedAt` as
 * `null` regardless of what the row holds, because none of them was part of the
 * statement. A caller needing their true value re-reads via `findById`.
 */
export interface UpsertReturnResult {
  record: ReturnRecord;
}
