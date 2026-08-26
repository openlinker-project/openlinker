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
   * Every unresolved restock block on a return — the derivation behind the
   * operator-facing badge and its segment (#2376, #2381).
   */
  listOutstandingRestockBlocks(returnId: string): Promise<RestockBlockedDetail[]>;
}
