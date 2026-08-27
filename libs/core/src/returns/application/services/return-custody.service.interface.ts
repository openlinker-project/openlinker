/**
 * Return Custody Service Interface (#2370, `W2-33`)
 *
 * The two operator write paths on a return line — **receive** and **dispose** —
 * plus the attestation that resolves a refused restock.
 *
 * @module application/services
 */
import type { ReturnLine } from '../../domain/entities/return-line.entity';
import type { ReturnLineEvent } from '../../domain/entities/return-line-event.entity';
import type { ReturnDisposition } from '../../domain/types/return-line.types';
import type {
  ReturnRestockBlockReason,
  ReturnRestockState,
} from '../../domain/types/return-line-event.types';

export interface ReceiveLineInput {
  quantity: number;
  note?: string | null;
  actorUserId?: string | null;
}

export interface DisposeLineInput {
  quantity: number;
  disposition: ReturnDisposition;
  note?: string | null;
  actorUserId?: string | null;
}

/**
 * What the operator must be told when the master refused (spec § 5.4).
 *
 * Returned in the **2xx body** of #2376's dispose response, not as an error: the
 * disposition succeeded and was recorded; it is the book write that failed. It
 * carries the quantity, the sku and the connection NAME because the remediation
 * copy names all three (*"Add {n} × {sku} in {connection name} yourself"*) and a
 * UI that had to fetch them separately would render the alarm a beat late.
 */
export interface RestockBlockedDetail {
  /** The act to attest to, if a surface ever wants per-attempt granularity. */
  eventId: string;
  /**
   * The line these units belong to (#2381).
   *
   * Required by every per-line surface, and NOT derivable from `sku`:
   * `return_lines` is unique on `(returnId, lineIndex)` and never on `sku`, so
   * two lines of one return can legitimately carry the same one (a re-order of
   * the same item). Keying a per-line notice by sku would render one line's
   * block under another line's — a specific false claim about which goods are
   * stuck, on the surface an operator uses to decide what to do about them.
   */
  returnLineId: string;
  quantity: number;
  sku: string | null;
  reason: ReturnRestockBlockReason;
  /** The adapter's own sentence — what an operator quotes in a support ticket. */
  detail: string | null;
  connectionId: string | null;
  connectionName: string | null;
  /** `blocked` (refused) or `in_doubt` (crossed, unobserved). */
  state: ReturnRestockState;
}

export interface ReceiveLineResult {
  line: ReturnLine;
  event: ReturnLineEvent;
}

export interface DisposeLineResult {
  line: ReturnLine;
  event: ReturnLineEvent;
  /**
   * Present iff the master write did not land. **Never an error** — see
   * {@link RestockBlockedDetail}. `null` on every scrap and every applied or
   * deduplicated restock.
   */
  restockBlocked: RestockBlockedDetail | null;
}

/**
 * Where a restock on this deployment WOULD land, asked before anything is
 * disposed of (spec § 5.3: *"Stock will be added in {connection name}"*).
 *
 * The three non-resolved arms deliberately reuse the SAME vocabulary
 * `blockedBeforeMaster` writes into `restockBlockedReason`, because they are the
 * same three conditions — a disclosure that named its states differently from
 * the block it predicts would be a second, drifting answer to one question.
 *
 * `ambiguous-inventory-master` is a **blocked** restock, not a pick: the write
 * path refuses to guess which book to write to, so a UI that rendered the first
 * candidate's name here would promise a write that is going to be refused.
 */
export const ReturnRestockTargetStatusValues = [
  'resolved',
  'ambiguous-inventory-master',
  'no-inventory-master',
  'adapter-unresolved',
] as const;

export type ReturnRestockTargetStatus = (typeof ReturnRestockTargetStatusValues)[number];

export type ReturnRestockTarget =
  | { status: 'resolved'; connectionId: string; connectionName: string }
  | { status: 'ambiguous-inventory-master'; candidateCount: number }
  | { status: 'no-inventory-master' }
  | { status: 'adapter-unresolved' };

/**
 * A recorded operator attestation that a refused restock was handled by hand
 * (#2381, spec § 5.4).
 *
 * The terminal state of the remediation loop. It carries no connection name and
 * no reason: those describe the BLOCK, and the block is gone by the time this
 * exists — restating them would re-raise an alarm the operator has answered.
 *
 * `actorUserId` is an ID, not a name, and callers must not pretend otherwise:
 * nothing in the tree resolves a user id to a display name (there is no
 * `IUsersService`), so a surface renders "by you" when it matches the session
 * user and "by another operator" when it does not.
 */
export interface RestockAttestationDetail {
  eventId: string;
  returnLineId: string;
  quantity: number;
  /** Who said so. An id — see the interface docblock. */
  actorUserId: string | null;
  /** When they said so. */
  occurredAt: Date;
  note: string | null;
}

export interface MarkNotReturnedInput {
  note?: string | null;
  actorUserId?: string | null;
}

export interface MarkNotReturnedResult {
  line: ReturnLine;
  event: ReturnLineEvent;
}

export interface AttestStockResult {
  line: ReturnLine;
  /** One attestation act per act it resolved. */
  events: ReturnLineEvent[];
}

export interface IReturnCustodyService {
  /**
   * Record that `quantity` more units arrived (spec § 5.2).
   *
   * Crosses no boundary and moves no stock, so it is NOT gated on attribution:
   * a parcel arriving at the operator's building is a fact whether or not OL can
   * name its order, and refusing to record it would make the orphan bucket
   * useless for exactly the returns it exists to hold.
   *
   * @throws {ReturnLineNotFoundError}
   * @throws {ReturnCustodyTransitionError} `over-receipt` / `non-positive-quantity` /
   *   `illegal-transition` — branch on `error.reason`, never on the message.
   */
  receiveLine(lineId: string, input: ReceiveLineInput): Promise<ReceiveLineResult>;

  /**
   * Record what became of `quantity` received units (spec § 5.3).
   *
   * On `restock` this writes the INVENTORY MASTER. On `scrap` it writes nothing
   * outside OL — *"Writes the units off. Stock is not changed."*
   *
   * A refused master write does NOT fail the call and does NOT roll back the
   * disposition: the goods really were disposed of, and the act is persisted.
   * What it does not do is move `quantityRestocked` — spec § 5.4 keeps the units
   * in `quantityReceived` until an operator attests, so nothing anywhere reports
   * them as restocked.
   *
   * @throws {ReturnNotAttributedError} restock only — an orphan restocks nothing.
   * @throws {ReturnCustodyContendedError} another custody write holds the line.
   * @throws {ReturnCustodyTransitionError} `over-disposition` / `illegal-transition` / …
   */
  disposeLine(lineId: string, input: DisposeLineInput): Promise<DisposeLineResult>;

  /**
   * Record that the parcel is not coming (spec § 5.2).
   *
   * **Always an operator act, never a timeout and never a sweep.** A parcel
   * that has not arrived is not the same fact as a parcel that is not coming,
   * and only a human is in a position to assert the second.
   *
   * **Not "mark the REMAINDER not returned", despite the spec's phrasing.** The
   * shipped model refuses a partially received line (#2367): custody is
   * single-valued per line, a line holding received units still needs a
   * disposition for them, and there is no `quantityNotReturned` counter for a
   * shortfall to move into. Where units did arrive the shortfall stays visible
   * as `quantityAdvised - quantityReceived`, which is what the spec was reaching
   * for; the operator-facing control is gated on `quantityReceived === 0` so
   * this refusal is never something they discover by clicking.
   *
   * Crosses no boundary and moves no stock, so — like {@link receiveLine} — it
   * is not gated on attribution.
   *
   * @throws {ReturnLineNotFoundError}
   * @throws {ReturnCustodyTransitionError} `partially-received` /
   *   `nothing-advised` / `illegal-transition` — branch on `error.reason`.
   */
  markLineNotReturned(
    lineId: string,
    input: MarkNotReturnedInput
  ): Promise<MarkNotReturnedResult>;

  /**
   * The operator attestation (spec § 5.4): *"Mark stock handled manually"*.
   *
   * Addressed by LINE, matching #2376's route and the spec's per-line action.
   * Settles every outstanding `blocked` / `in_doubt` restock act on the line,
   * moving their units into `quantityRestocked` with
   * `restockedBy: 'operator_out_of_band'` and recording who attested and when.
   *
   * **It never writes stock and never claims OL did.** The timeline keeps both
   * entries — the block and the attestation — permanently; only the *attention*
   * clears.
   *
   * @throws {ReturnRestockAttestationInvalidError} nothing outstanding to attest.
   */
  markStockHandledManually(
    lineId: string,
    input: { actorUserId?: string | null; note?: string | null }
  ): Promise<AttestStockResult>;

  /**
   * Where a restock would land, resolved BEFORE any disposition (#2380).
   *
   * Exists so spec § 5.3's *"Stock will be added in {connection name}"* can be
   * shown while the operator is choosing, rather than only afterwards on a
   * `restockBlocked` response — which is to say, only once it already failed.
   *
   * **Reported === written-to, structurally.** It answers from the very same
   * private resolver the dispose path uses, so the name shown and the book
   * written cannot disagree. That is the whole reason this is a service method
   * rather than a client-side read of `enabledCapabilities`: the resolver's
   * candidate ordering is not reproducible in a browser, so a client-side pick
   * could confidently name a connection the write never touched.
   *
   * Never throws: every failure is one of the three non-resolved arms.
   */
  getRestockTarget(): Promise<ReturnRestockTarget>;

  /**
   * Every unresolved restock block on a return — the derivation behind the
   * operator-facing badge and its segment (#2376, #2381).
   */
  listOutstandingRestockBlocks(returnId: string): Promise<RestockBlockedDetail[]>;

  /**
   * Every recorded attestation on a return (#2381).
   *
   * Not derivable from {@link listOutstandingRestockBlocks}: attesting flips the
   * act OUT of the outstanding set, so the two reads are disjoint by
   * construction and a surface needs both — one to raise the alarm, one to show
   * it was answered.
   */
  listRestockAttestations(returnId: string): Promise<RestockAttestationDetail[]>;
}
