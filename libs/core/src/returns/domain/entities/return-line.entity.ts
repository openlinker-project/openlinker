/**
 * Return Line Domain Entity
 *
 * One line of a return: what is coming back, how much of it has actually
 * arrived, and what became of it (#2327, ADR-060).
 *
 * Anemic and fully `readonly` per ADR-011 — no state mutation, no transition
 * guard, no derived stage. The counters are the model: `quantityAdvised >=
 * quantityReceived >= quantityRestocked + quantityScrapped`, enforced by a DB
 * CHECK (`CHK_return_lines_quantity_ordering`) rather than by a method here, so
 * no caller — including one that bypasses this context — can persist an
 * impossible line. Counters express partial receipt and partial disposition
 * natively; a per-line status could not.
 *
 * `custodyState` / `moneyState` / `disposition` land at their defaults and are
 * NOT driven by this slice (Wave 2).
 *
 * @module domain/entities
 */
import type {
  ReturnCustodyState,
  ReturnDisposition,
  ReturnMoneyState,
} from '../types/return-line.types';
import type { RefundReason } from '@openlinker/core/orders/types';

export class ReturnLine {
  constructor(
    /** Opaque uuid — a line is never referenced from outside the aggregate. */
    public readonly id: string,
    public readonly returnId: string,
    public readonly lineIndex: number,
    public readonly externalLineId: string | null,
    /** Nullable by design — no `order_records` lines table exists to point at. */
    public readonly resolvedOrderLineId: string | null,
    public readonly offerId: string | null,
    public readonly sku: string | null,
    public readonly name: string | null,
    public readonly reason: RefundReason,
    public readonly quantityAdvised: number,
    public readonly quantityReceived: number,
    public readonly quantityRestocked: number,
    public readonly quantityScrapped: number,
    public readonly custodyState: ReturnCustodyState,
    public readonly moneyState: ReturnMoneyState,
    public readonly disposition: ReturnDisposition | null,
    public readonly receivedAt: Date | null,
    public readonly disposedAt: Date | null,
    public readonly note: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}
}
