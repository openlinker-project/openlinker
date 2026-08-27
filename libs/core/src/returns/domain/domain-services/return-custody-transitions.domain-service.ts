/**
 * Return Custody Transitions (#2367, `W2-30`, ADR-060)
 *
 * The rules that MOVE `ReturnLine.custodyState`. Wave 1c declared the five-value
 * union and shipped the column defaulted to `advised` and never written; this
 * file is what writes to it — or rather, what DECIDES what should be written.
 *
 * ## Pure, and deliberately not a service
 *
 * No I/O, no injected dependency, no framework import, no clock of its own, no
 * mutation of its arguments. It follows the shape every other shipped rule
 * engine in this tree takes — `applyPricingRule`, `applyStockSafetyBuffer`,
 * `checkRequiredToSell`, `applyDescriptionFormat`, `splitShippingAcrossRates`,
 * `resolveSalesDocumentRouting`, and, in this same programme,
 * `deriveOrderLifecyclePhase` — a plain exported function consumed directly. An
 * `@Injectable` forwarding to a pure function with nothing to inject is
 * ceremony, and worse than that here: #2370 computes its custody move INSIDE
 * the transaction that already holds the row, and a service method would invite
 * a second read and with it a read-then-write race.
 *
 * ## What this owns, and what #2370 owns
 *
 * This decides the resulting `custodyState`, `receivedAt` and `disposedAt`, and
 * the counters the move implies. It PERSISTS nothing. #2370 (`W2-33`) owns the
 * repository write, its transaction, the `restock_blocked` column, the master
 * `adjustInventory` call and the T6/T7 automation triggers. A caller applies the
 * returned {@link ReturnCustodyOutcome} to the row it already loaded.
 *
 * ## Clocks — which instants OL may mint, and which it may not
 *
 * `received`, `disposed` and `not_returned` are all entered by an OPERATOR
 * acting inside OpenLinker, so OL is the actor and OL's clock is the authority
 * for their timestamps. `in_transit` is the exception: it is a claim about the
 * outside world (the buyer handed a parcel to a carrier) that OL cannot witness,
 * so {@link advanceReturnCustodyToInTransit} takes the SOURCE's own instant and
 * a caller with no source-reported instant has no business making the move. That
 * is the same rule #2336 fixed `declinedAt` under: a 2xx must never stand in for
 * a channel-reported fact.
 *
 * ## The reversal gate, restated where it can be acted on
 *
 * `inspected` is absent from the union by #2327's adjudication, and re-admitting
 * it is a decision rather than a fix. The gate is a `ReturnReceiver` / 3PL
 * receiving integration that can report an inspection OUTCOME, i.e. where the
 * receiving party and the adjudicating party genuinely differ — and it must be
 * added BEFORE any downstream consumer branches on custody, never after. Every
 * switch in this file is closed with `assertNever`, so adding the value makes
 * each site a compile error rather than a silent fallthrough.
 *
 * @module libs/core/src/returns/domain/domain-services
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 * @see docs/specs/product-spec-oms-returns-operator-ux.md § 3.1, § 5.2, § 5.3
 */
import { assertNever } from '@openlinker/shared/types';

import { ReturnCustodyTransitionError } from '../exceptions/return-custody-transition.error';
import type { ReturnCustodyState, ReturnDisposition } from '../types/return-line.types';

/**
 * The projection of one line these rules read.
 *
 * Deliberately a structural projection rather than a `ReturnLine`: #2370 calls
 * this with the row it has locked inside its own transaction (an ORM row, not a
 * hydrated aggregate), and a later frontend mirror has one small shape to
 * mirror rather than an entity with twenty fields.
 */
export interface ReturnCustodyLineFacts {
  custodyState: ReturnCustodyState;
  quantityAdvised: number;
  quantityReceived: number;
  quantityRestocked: number;
  quantityScrapped: number;
  receivedAt: Date | null;
  disposedAt: Date | null;
}

/**
 * What the line should look like after the move.
 *
 * The counters are reported because the transition is quantity-AWARE — the
 * resulting state is a function of them, so computing them twice (once to
 * decide the state, once to write the row) is how the two start disagreeing.
 * They are still #2370's to persist.
 */
export interface ReturnCustodyOutcome {
  custodyState: ReturnCustodyState;
  quantityReceived: number;
  quantityRestocked: number;
  quantityScrapped: number;
  receivedAt: Date | null;
  disposedAt: Date | null;
}

/**
 * Is this line's custody finished — i.e. does it still need something done to
 * the goods?
 *
 * The custody half of the returns list's `All open` segment (spec § 4.1). Money
 * is the other half and is NOT consulted here: the two machines are orthogonal
 * by ADR-060, and folding them together in a helper is how they get collapsed.
 */
export function isReturnCustodyFinished(state: ReturnCustodyState): boolean {
  switch (state) {
    case 'advised':
    case 'in_transit':
    case 'received':
      return false;
    case 'disposed':
    case 'not_returned':
      return true;
    default:
      return assertNever(state, 'ReturnCustodyState');
  }
}

/**
 * `advised` -> `in_transit`. The one custody fact OL cannot witness.
 *
 * @param observedAt the SOURCE's own instant for the dispatch. Required, and
 *   never `new Date()` — see the clock rule in this file's header. Nothing
 *   persists it today (the model carries no `inTransitAt` column), so it is a
 *   proof obligation on the caller rather than a stored value; a column for it
 *   is additive if a surface ever needs to render the instant.
 * @throws {ReturnCustodyTransitionError} `illegal-transition` from any other
 *   state. Re-observing a line already `in_transit` is deliberately a refusal
 *   rather than a no-op: a source re-reporting dispatch tells the caller nothing
 *   new, and silently succeeding would hide a caller that lost track of state.
 */
export function advanceReturnCustodyToInTransit(
  line: ReturnCustodyLineFacts,
  input: { observedAt: Date }
): ReturnCustodyOutcome {
  void input.observedAt;

  if (line.custodyState !== 'advised') {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'in_transit',
      'illegal-transition',
      'only an advised line can be reported in transit'
    );
  }

  return {
    custodyState: 'in_transit',
    quantityReceived: line.quantityReceived,
    quantityRestocked: line.quantityRestocked,
    quantityScrapped: line.quantityScrapped,
    receivedAt: line.receivedAt,
    disposedAt: line.disposedAt,
  };
}

/**
 * Record that `quantity` more units arrived. `advised` / `in_transit` /
 * `received` -> `received`.
 *
 * `received` is re-entrant on purpose: a return arriving in two parcels is
 * ordinary, and the counters — not the state — are what express partial
 * receipt (spec § 3.1 point 3). `receivedAt` is stamped AT MOST ONCE, on the
 * first receipt, because it answers "when did the parcel arrive", not "when was
 * this line last touched".
 *
 * A receipt on a `disposed` line clears `disposedAt` and returns the line to
 * `received`: more units arrived than have been dealt with, so the line is
 * demonstrably not finished, and leaving a `disposedAt` on it would date a
 * completion that has been undone.
 *
 * @throws {ReturnCustodyTransitionError} `non-positive-quantity`,
 *   `over-receipt` (spec § 5.2 — OL does not silently widen a marketplace's own
 *   claim), or `illegal-transition` from `not_returned` (which asserts the goods
 *   are not coming; a parcel that then arrives is a different fact than a
 *   receipt, and re-opening it is a decision #2370/#2376 must surface, not
 *   something to absorb here).
 */
export function applyReturnCustodyReceipt(
  line: ReturnCustodyLineFacts,
  input: { quantity: number; at: Date }
): ReturnCustodyOutcome {
  assertPositiveQuantity(line.custodyState, 'received', input.quantity);

  if (line.custodyState === 'not_returned') {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'received',
      'illegal-transition',
      'this line was marked not returned; re-open it before recording a receipt'
    );
  }

  const quantityReceived = line.quantityReceived + input.quantity;
  if (quantityReceived > line.quantityAdvised) {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'received',
      'over-receipt',
      `advised ${line.quantityAdvised}, already received ${line.quantityReceived}, receiving ${input.quantity}`
    );
  }

  return {
    custodyState: 'received',
    quantityReceived,
    quantityRestocked: line.quantityRestocked,
    quantityScrapped: line.quantityScrapped,
    receivedAt: line.receivedAt ?? input.at,
    disposedAt: null,
  };
}

/**
 * Record what became of `quantity` received units. `received` -> `received`
 * while units remain undealt-with, `received` -> `disposed` once they do not.
 *
 * The line becomes `disposed` exactly when `restocked + scrapped` reaches
 * `received`, and `disposedAt` stamps on that transition — so a return that is
 * disposed in two passes carries the instant the LAST unit was dealt with,
 * which is the instant the line actually finished.
 *
 * A `restock` that the inventory master then refuses is still a disposition:
 * #2370 records `restock_blocked` beside it and does not roll this back (the
 * goods really were disposed of; the book write is what failed). That is why
 * this function takes the disposition and not its outcome.
 *
 * A line already `disposed` is accepted by the state guard and then refused by
 * the counter check as `over-disposition` — deliberately, because that is the
 * accurate reason (every received unit is already dealt with), and reporting
 * `illegal-transition` there would send an operator looking for a state problem
 * that does not exist. Such a line becomes reachable again only through a
 * further receipt, which re-opens it to `received`.
 *
 * @throws {ReturnCustodyTransitionError} `non-positive-quantity`,
 *   `over-disposition`, or `illegal-transition` from any state that has not
 *   received units.
 */
export function applyReturnCustodyDisposition(
  line: ReturnCustodyLineFacts,
  input: { quantity: number; disposition: ReturnDisposition; at: Date }
): ReturnCustodyOutcome {
  assertPositiveQuantity(line.custodyState, 'disposed', input.quantity);

  if (line.custodyState !== 'received' && line.custodyState !== 'disposed') {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'disposed',
      'illegal-transition',
      'record what arrived before disposing of it'
    );
  }

  const disposed = line.quantityRestocked + line.quantityScrapped + input.quantity;
  if (disposed > line.quantityReceived) {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'disposed',
      'over-disposition',
      `received ${line.quantityReceived}, already disposed ${
        line.quantityRestocked + line.quantityScrapped
      }, disposing ${input.quantity}`
    );
  }

  const finished = disposed === line.quantityReceived;

  return {
    custodyState: finished ? 'disposed' : 'received',
    quantityReceived: line.quantityReceived,
    quantityRestocked:
      input.disposition === 'restock'
        ? line.quantityRestocked + input.quantity
        : line.quantityRestocked,
    quantityScrapped:
      input.disposition === 'scrap'
        ? line.quantityScrapped + input.quantity
        : line.quantityScrapped,
    receivedAt: line.receivedAt,
    disposedAt: finished ? line.disposedAt ?? input.at : null,
  };
}

/**
 * `advised` / `in_transit` -> `not_returned`. Always an operator act.
 *
 * **Never a timeout and never a sweep** (spec § 5.2). A parcel that has not
 * arrived is not the same fact as a parcel that is not coming, and only a human
 * is in a position to assert the second. That also settles the question
 * `ReturnRepository.warnOnVanishedLines` left open for Wave 2: a line the source
 * stops reporting is NOT auto-transitioned here — the source withdrawing a line
 * says nothing about physical custody, and this rule is what forbids inferring
 * it.
 *
 * **Refused on a partially received line**, and that refusal is a deliberate
 * gap rather than an oversight. Spec § 5.2's *"Mark remainder not returned"* has
 * no home in the shipped model: custody is single-valued per line, a line that
 * received some units still holds goods needing disposition, and there is no
 * `quantityNotReturned` counter for the shortfall to move into. Such a line
 * finishes on the received branch (`received` -> `disposed`) with the shortfall
 * permanently visible as `quantityAdvised - quantityReceived`, which is what the
 * spec asks the operator to see. Giving the shortfall a state of its own is a
 * model change — a column, a migration and a spec amendment — not something to
 * approximate here.
 *
 * **Takes no instant**, unlike the other three, and that asymmetry is
 * deliberate: the model persists no `notReturnedAt` column, so a parameter here
 * would be neither stored nor a proof obligation on the caller (which is what
 * `observedAt` is on the in-transit transition) — just API noise a consumer has
 * to invent a value for.
 *
 * **Refused on a line advising zero units**, with its own `nothing-advised`
 * reason. The act this move mints carries the shortfall as its quantity, and
 * with nothing received the shortfall IS `quantityAdvised` — so a zero would
 * be refused downstream by `CHK_return_line_events_quantity_positive` as a raw
 * driver error, i.e. a 500 for a state the domain can name. Naming it here puts
 * it in the same closed union every other refusal on this path uses, which is
 * what lets the #2376 filter answer 409 with a code the frontend can branch on.
 *
 * @throws {ReturnCustodyTransitionError} `partially-received`,
 *   `nothing-advised`, or `illegal-transition` from a terminal state.
 */
export function markReturnCustodyNotReturned(line: ReturnCustodyLineFacts): ReturnCustodyOutcome {
  // A FINISHED line first. Nothing more specific can be said about it, and
  // saying something more specific would be wrong.
  if (line.custodyState === 'disposed' || line.custodyState === 'not_returned') {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'not_returned',
      'illegal-transition',
      'this line is already finished'
    );
  }

  // BEFORE the remaining state check, and the order is load-bearing (#2380).
  // A receipt moves the line to `received`, so a state check placed first
  // shadows this branch completely: `partially-received` was unreachable
  // through any real path, and an operator whose parcel was half-delivered was
  // told the line was "already finished" — which is false, and points them at
  // the wrong remedy. The unit test that covered this constructed an
  // `in_transit` line with received units, a state the receipt transition never
  // produces, so it passed against a reason nothing could emit.
  if (line.quantityReceived > 0) {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'not_returned',
      'partially-received',
      `${line.quantityReceived} of ${line.quantityAdvised} units already arrived; dispose of them and leave the shortfall visible`
    );
  }

  if (line.custodyState !== 'advised' && line.custodyState !== 'in_transit') {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'not_returned',
      'illegal-transition',
      'only a line still awaiting its parcel can be marked not returned'
    );
  }

  if (line.quantityAdvised <= 0) {
    throw new ReturnCustodyTransitionError(
      line.custodyState,
      'not_returned',
      'nothing-advised',
      'the source advised no units on this line, so there is no shortfall to write off'
    );
  }

  return {
    custodyState: 'not_returned',
    quantityReceived: line.quantityReceived,
    quantityRestocked: line.quantityRestocked,
    quantityScrapped: line.quantityScrapped,
    receivedAt: line.receivedAt,
    disposedAt: line.disposedAt,
  };
}

/**
 * A quantity must be a positive whole number of units. Shared so the two
 * quantity-bearing transitions cannot disagree about what "a quantity" is.
 */
function assertPositiveQuantity(
  from: ReturnCustodyState,
  attempted: ReturnCustodyState,
  quantity: number
): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ReturnCustodyTransitionError(
      from,
      attempted,
      'non-positive-quantity',
      `received ${String(quantity)}`
    );
  }
}
