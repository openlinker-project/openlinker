/**
 * Return Line Event Domain Entity
 *
 * One ACT against a return line (#2370, ADR-060): a receipt, a disposition, or
 * an operator's attestation that they handled the stock themselves.
 *
 * Anemic and fully `readonly` per ADR-011. The ledger is append-only in intent
 * — the one field that changes after insert is the restock outcome, settled
 * once when the master answers (or does not), through an explicit repository
 * method rather than a mutator here.
 *
 * @module domain/entities
 */
import type {
  ReturnLineEventKind,
  ReturnRestockBlockReason,
  ReturnRestockState,
  RestockedBy,
} from '../types/return-line-event.types';
import type { ReturnDisposition } from '../types/return-line.types';

export class ReturnLineEvent {
  constructor(
    /** Opaque uuid — the `return_lines` precedent; never referenced externally. */
    public readonly id: string,
    public readonly returnId: string,
    public readonly returnLineId: string,
    /**
     * Position within this line's own act history, allocated by the repository.
     * It is the `{seq}` of the `return:{returnId}:{lineId}:{seq}` idempotency
     * key (#2368), which is why it is unique per line and never recomputed.
     */
    public readonly seq: number,
    public readonly kind: ReturnLineEventKind,
    public readonly quantity: number,
    public readonly disposition: ReturnDisposition | null,
    public readonly restockState: ReturnRestockState,
    public readonly restockBlockedReason: ReturnRestockBlockReason | null,
    /** The adapter's own words, so an operator can quote them (#2231's rule). */
    public readonly restockBlockedDetail: string | null,
    public readonly restockedBy: RestockedBy | null,
    /** Which inventory master this attempt was made against, if one was chosen. */
    public readonly masterConnectionId: string | null,
    public readonly note: string | null,
    public readonly actorUserId: string | null,
    public readonly occurredAt: Date,
    public readonly attestedByEventId: string | null,
    public readonly createdAt: Date
  ) {}
}
