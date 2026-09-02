/**
 * Allegro Customer Return Mapper
 *
 * Pure projection of Allegro's `[BETA]` `CustomerReturn` wire shape onto the
 * neutral `IncomingReturn` / `ReturnFeedItem` contracts (#2330).
 *
 * Extracted into its own module rather than inlined on the adapter — the
 * `allegro-payment-status.ts` precedent — because `AllegroOrderSourceAdapter`
 * already carries three interfaces and 780 lines, and this mapping is pure: no
 * HTTP, no connection, no logger state. That also makes the table-driven status
 * and reason specs trivial to write against it directly.
 *
 * ## What is projected, and what deliberately is not
 *
 * `refund.bankAccount`, `parcels[]` and `rejection` are NOT projected onto any
 * neutral field. Each is real and useful, and none has a home in the neutral
 * contract this wave shipped: a bank account is money-authority data ADR-060
 * keeps away from a source projection, parcels are a shipping concern with its
 * own aggregate, and a rejection is a *seller decision* whose OL counterpart is
 * #2333's decline path — projecting it now would let a marketplace's refusal
 * masquerade as OL's own. All three survive verbatim in `raw`, so nothing is
 * lost and the decision stays reversible.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 */
import type { IncomingReturn, IncomingReturnLine, ReturnFeedItem } from '@openlinker/core/returns';
import type {
  AllegroCustomerReturnItemWire,
  AllegroCustomerReturnWire,
} from '../../domain/types/allegro-customer-return.types';
import { ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES } from '../../domain/types/allegro-customer-return.types';

/**
 * Whether Allegro considers this return finished.
 *
 * Reads the SAME constant the adapter publishes as `terminalRawStatuses`, which
 * is what keeps the sweep's SQL exclusion and the per-observation hint from
 * disagreeing. Comparison is exact — no casing normalisation, no trimming:
 * Allegro's statuses are a fixed upper-case vocabulary, and quietly accepting
 * `finished` would mean quietly accepting a value the source never sends,
 * hiding a real shape change behind a lenient match.
 */
export function isAllegroReturnTerminal(status: string | undefined): boolean {
  if (status === undefined) {
    return false;
  }
  return (ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * One feed item — a reference, never the return itself.
 *
 * Returns `null` when the source reported no usable id. The caller counts and
 * drops it: a feed row OL cannot name is a row it can never hydrate, and
 * refusing the whole page over one would wedge the connection's cursor forever
 * (the row would be just as malformed on every retry).
 *
 * `eventKey` is tautologically the return id here, because Allegro's feed IS the
 * return listing and carries no event vocabulary at all. The neutral contract
 * keeps the field separate anyway so a source with a genuine journal needs no
 * change.
 */
export function toReturnFeedItem(wire: AllegroCustomerReturnWire): ReturnFeedItem | null {
  const externalReturnId = typeof wire.id === 'string' ? wire.id.trim() : '';
  if (externalReturnId === '') {
    return null;
  }

  return {
    externalReturnId,
    externalOrderId: nullableString(wire.orderId),
    // `createdAt` is the only timestamp the resource carries; when it is absent
    // the item still exists and must still be hydrated, so the field degrades
    // to empty rather than the row being dropped.
    occurredAt: typeof wire.createdAt === 'string' ? wire.createdAt : '',
    eventKey: externalReturnId,
    raw: wire,
  };
}

/**
 * The hydrated return.
 *
 * `rawStatus` is passed through **verbatim**, including the empty string when
 * Allegro sends nothing. Defaulting an absent status to any member of the
 * vocabulary would be OL inventing a claim about the buyer's money; an empty
 * string is honestly "the source did not say", and — because it matches no
 * terminal value — leaves the return in the sweep's candidate set, which is the
 * safe direction.
 */
export function toIncomingReturn(wire: AllegroCustomerReturnWire): IncomingReturn {
  const rawStatus = typeof wire.status === 'string' ? wire.status : '';

  return {
    externalReturnId: typeof wire.id === 'string' ? wire.id : '',
    // Nullable, not optional: an orphan return is a first-class observation, so
    // "Allegro reported no order" must be distinguishable from "the adapter
    // forgot to map it".
    externalOrderId: nullableString(wire.orderId),
    referenceNumber: optionalString(wire.referenceNumber),
    rawStatus,
    createdAt: typeof wire.createdAt === 'string' ? wire.createdAt : '',
    isTerminalAtSource: isAllegroReturnTerminal(wire.status),
    buyerEmail: optionalString(wire.buyer?.email),
    marketplaceId: optionalString(wire.marketplaceId),
    lines: (wire.items ?? []).map((item) => toIncomingReturnLine(item)),
    raw: wire,
  };
}

/**
 * One returned line.
 *
 * **No `externalLineId` is emitted.** Allegro assigns none — its items key on
 * `offerId` with no reference back to an order line — and stringifying the
 * array position is Erli's rule, adopted there only because that source has no
 * return id at all. Minting one here would invent an identifier the source does
 * not have, and core's `lineIndex` already carries the positional coordinate.
 */
export function toIncomingReturnLine(item: AllegroCustomerReturnItemWire): IncomingReturnLine {
  return {
    offerId: optionalString(item.offerId),
    name: optionalString(item.name),
    // A line without a quantity is still a returned line; 0 is the honest
    // reading of "the source did not say how many" and keeps the arithmetic
    // total truthful rather than inflating it with a guessed 1.
    quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity)
      ? item.quantity
      : 0,
    unitPrice: parseAmount(item.price?.amount),
    // `reason.type` only — `userComment` is buyer free text and is deliberately
    // NOT concatenated in. Core maps `reasonRaw` onto a `RefundReason`
    // vocabulary, and prepending prose would defeat every one of those matches
    // for exactly the returns whose buyer bothered to explain themselves. The
    // comment survives in `raw`.
    reasonRaw: optionalString(item.reason?.type),
    serialNumbers: item.serialNumbers,
    raw: item,
  };
}

/**
 * Allegro sends money as a string "to avoid rounding errors"; the neutral
 * contract wants a bare number (the `IncomingOrderItem.price` precedent).
 *
 * An unparseable or non-finite value yields `undefined` — the field is
 * optional, and "not reported" is a state a consumer can handle, whereas a
 * `NaN` silently poisons every sum it reaches.
 */
function parseAmount(amount: string | undefined): number | undefined {
  if (typeof amount !== 'string' || amount.trim() === '') {
    return undefined;
  }
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * `null`, never `undefined` — the neutral contract makes `externalOrderId`
 * nullable-not-optional precisely so the two cannot be confused.
 */
function nullableString(value: string | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
