/**
 * Return Types (header)
 *
 * The `returns` context's header vocabulary and create-input shape (#2327,
 * ADR-060).
 *
 * **There is deliberately no `status` union here.** ADR-060's central claim is
 * that authorization is an *action*, not a state: no source reports a lifecycle
 * OL can derive (Allegro's status is an 11-value timeline; Erli's returns carry
 * neither id nor status), so a status column would be OL inventing a machine it
 * cannot drive. What the header carries instead is four INDEPENDENT nullable
 * timestamps — `openedAt` / `authorizedAt` / `declinedAt` / `closedAt` — each a
 * fact about something that happened, none mutually exclusive with the others;
 * a presentation projection (returns product spec § 3.2) rolls them up for an
 * operator, and no transition guard lives in this slice. `rawStatus` is the
 * source's own word, stored verbatim and never interpreted.
 *
 * @module domain/types
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */
import type { CreateReturnLineInput } from './return-line.types';

/**
 * Where the return came from.
 *
 * `source_ingested` — pulled from a marketplace/shop feed (#2329). The source
 * is authoritative on its own fields and a re-pull overwrites them; OL-owned
 * fields are never touched by ingestion.
 * `operator_authored` — an operator opened it in OL because the source has no
 * returns surface at all. Only these may be `return.authorize`d: OL must not
 * pretend to decide what the marketplace already decided (ADR-060).
 */
export const ReturnOriginValues = ['source_ingested', 'operator_authored'] as const;

export type ReturnOrigin = (typeof ReturnOriginValues)[number];

/**
 * Create-input for one return header plus its lines.
 *
 * Lines arrive with the header because a return with no line is not a return —
 * there is nothing to receive, restock or refund. The idempotent
 * update-or-create keyed `(sourceConnectionId, externalReturnId)` is #2328's
 * job; the partial unique index this slice ships is what makes it possible.
 * See `docs/plans/analysis/DESIGN-oms-authority-model.md` § 7.3 (:784-785) for
 * the key itself (ADR-060 has no § 7.3).
 */
export interface CreateReturnRecordInput {
  sourceConnectionId: string;
  /**
   * The source's own return id, when it has one. NULL for a source that mints
   * none (Erli) and for an operator-authored return. Whether an id-less source
   * should instead be given a SYNTHETIC external key is #2328's gate decision —
   * the partial unique index supports either answer, so the model stays
   * neutral rather than pre-empting it.
   */
  externalReturnId: string | null;
  /** Nullable BY DESIGN — see `ReturnRecord`'s docblock (orphan returns persist). */
  internalOrderId: string | null;
  origin: ReturnOrigin;
  /** The source's own status word, verbatim. Never parsed, never mapped. */
  rawStatus: string | null;
  /** The source payload as received. See the ORM column docblock for the PII posture. */
  rawPayload: Record<string, unknown> | null;
  openedAt: Date | null;
  authorizedAt: Date | null;
  declinedAt: Date | null;
  closedAt: Date | null;
  lines: CreateReturnLineInput[];
}
