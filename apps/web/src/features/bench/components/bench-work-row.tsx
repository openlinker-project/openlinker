/**
 * One parcel on the bench (#2416, `W3b-3`, stories B2/B4/B5; laid out as the
 * mockup's `.rail-row` by the mockup-parity epic #3401)
 *
 * ## The WHOLE row opens the parcel
 *
 * `docs/plans/mockups/pack-bench-redesign.html` makes each rail row one
 * clickable target, which is what a gloved hand needs — not a small button on
 * the right of a card. The row is therefore a `<button>` carrying the row's
 * content, labelled `Open parcel` so its accessible name says what it does
 * rather than reading the whole card aloud, and described by the meta line so
 * the content is still announced.
 *
 * A row that may NOT be opened renders the same content as a plain `<div>`
 * plus the reason. Secondary actions (expedite, claim) sit in a footer strip
 * OUTSIDE that button — a button inside a button is invalid, and the mockup
 * shows exactly this shape on its own unassigned row.
 *
 * ## ONE badge, and the section carries the rest (B4)
 *
 * The mockup gives a row a single badge holding its most salient state, and
 * leaves the assignment fact to the section it sits in. This row does the
 * same: held ▸ cancelled ▸ expedited ▸ deadline, in that order. Nothing is
 * lost, because every state is ALSO written in words — the badge, the meta
 * line, and the note under it — and `bench-work-row.test.tsx` asserts state
 * from `textContent` only, so a change that moved a signal into colour would
 * fail.
 *
 * ## Nothing here says the goods are ready (B2)
 *
 * The counts read *items* and *units to scan*. There is no "picked", no
 * "gathered", no progress bar — a bar would imply someone had already fetched
 * part of it, which OpenLinker has no way to know.
 *
 * ## The assignment badge is a UX affordance, never the guarantee (#3341, ADR-074)
 *
 * `assignmentState` and `claimable` are computed server-side and read
 * verbatim — never re-derived from `assignedToUserId` (this row is never
 * handed that raw id; see `BenchWorkView`'s own docblock for why). Hiding the
 * open control when `claimable` is false is convenience: the actual guarantee
 * is `BenchParcelService.verifyUnit`'s own re-check, which still fires even if
 * this row somehow rendered the control anyway.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { BenchWork } from '../api/bench-work.types';
import { describeBenchDeadline, expediteActionFor } from '../lib/bench-work-presentation';
import { benchWorkCopy } from '../lib/bench-work.copy';
import { BenchThumb } from './bench-thumb';

export interface BenchWorkRowProps {
  readonly work: BenchWork;
  /** `now` is injected so the deadline phrasing is testable without a clock. */
  readonly now?: Date;
  /** Whether this session may reorder the queue. See `BenchWorkList`. */
  readonly canExpedite: boolean;
  readonly onExpedite: (work: BenchWork, action: 'expedite' | 'release_expedite') => void;
  readonly expediting?: boolean;
  /**
   * #2418's seam. Absent renders no control — see the module docblock.
   *
   * Takes the id, not the whole row (#3416) — every caller only ever read
   * `work.workId` off it, and the unlabelled rail row shares this same
   * callback while having no `BenchWork` to hand back.
   */
  readonly onOpenParcel?: (workId: string) => void;
  /**
   * #3412/#3416 — explicit pre-claim, offered alongside the row's own open
   * gesture rather than instead of it: the shipped model already lets any
   * packer open an unassigned+claimable row directly
   * (`BenchParcelService.verifyUnit`'s own re-check is the real guarantee, not
   * a claim pre-step), so this is the ADDITIONAL "claim several, work through
   * them in order" path the mockup's "Claim this parcel" button demonstrates.
   * Rendered only for an `unassigned` row when supplied.
   */
  readonly onClaim?: (work: BenchWork) => void;
  readonly claiming?: boolean;
  /**
   * Whether this is the box open in the pane beside the rail (#3401). Marks
   * the row `aria-current="true"`, which is what the mockup's own
   * `.rail-row[aria-current]` rule tints. Never the carrier of any state —
   * every word on the row is unchanged by it.
   */
  readonly active?: boolean;
}

function toneFor(work: BenchWork): StatusBadgeTone {
  if (work.state === 'cancelled') return 'neutral';
  if (work.state === 'held') return 'error';
  return 'info';
}

export function BenchWorkRow({
  work,
  now,
  canExpedite,
  onExpedite,
  expediting = false,
  onOpenParcel,
  onClaim,
  claiming = false,
  active = false,
}: BenchWorkRowProps): ReactElement {
  const deadline = describeBenchDeadline(work.dispatchByAt, now);
  const expediteAction = expediteActionFor(work);
  const expedited = work.expeditedAt !== null;
  const metaId = `bench-work-row-meta-${work.workId}`;

  /** The one badge. See the module docblock for the priority and why. */
  const badge =
    work.state === 'held' ? (
      <StatusBadge tone={toneFor(work)} withDot compact>
        {benchWorkCopy.row.heldBadge}
      </StatusBadge>
    ) : work.state === 'cancelled' ? (
      <StatusBadge tone={toneFor(work)} withDot compact>
        {benchWorkCopy.row.cancelledBadge}
      </StatusBadge>
    ) : expedited ? (
      <StatusBadge tone="warning" withDot compact>
        {benchWorkCopy.row.expeditedBadge}
      </StatusBadge>
    ) : (
      <StatusBadge tone="warning" compact>
        {deadline.headline}
      </StatusBadge>
    );

  const hiddenItemCount = Math.max(0, work.lineCount - work.items.length);

  const body = (
    <>
      {/* WHAT IS IN THE BOX, first and loudest (#3415).
          The row used to lead with the order reference, which on this data is
          a 36-character uuid - the biggest thing on the row and the one thing
          a packer cannot act on. They are choosing which trolley to walk to,
          so the row leads with the goods and keeps the reference underneath as
          the value they read out when they ring the office.
          The deadline badge keeps its place beside it: it is the OTHER thing a
          packer triages on, and demoting it would trade one problem for another. */}
      {/* The badge sits on its OWN line above the goods, not beside them.
          Beside them it is `flex-shrink: 0` against a rail barely 330px wide,
          so "Kubek ceramiczny bialy 300ml" arrived as "Kubek cer..." - the
          row led with the products and then refused to show them. A packer
          reads the deadline first and the names second, so stacking costs one
          line and buys the full width for the thing the row is about. */}
      {badge === null ? null : <span className="bench-work-row__flag">{badge}</span>}

      <span className="bench-work-row__top">
        <span className="bench-work-row__items">
          {work.items.length === 0 ? (
            // A parcel whose every line was cancelled to zero. The row still
            // renders and is still openable - saying nothing here would make
            // it look broken rather than empty.
            <span className="bench-work-row__item bench-work-row__item--empty">
              {benchWorkCopy.row.summary({
                parcelIndex: work.parcelIndex,
                parcelTotal: work.parcelTotal,
                lineCount: work.lineCount,
                unitsToVerify: work.unitsToVerify,
              })}
            </span>
          ) : (
            work.items.map((item, index) => (
              <span
                className="bench-work-row__item"
                key={`${item.name ?? 'unnamed'}:${String(index)}`}
              >
                <BenchThumb
                  className="bench-work-row__thumb"
                  imageUrl={item.imageUrl}
                  name={item.name}
                />
                <span className="bench-work-row__item-qty tabular">
                  {benchWorkCopy.row.itemQuantity(item.quantity)}
                </span>
                <span
                  className={
                    item.name === null
                      ? 'bench-work-row__item-name bench-work-row__item-name--unnamed'
                      : 'bench-work-row__item-name'
                  }
                  title={item.name ?? undefined}
                >
                  {item.name ?? benchWorkCopy.row.itemUnnamed}
                </span>
              </span>
            ))
          )}
          {hiddenItemCount === 0 ? null : (
            <span className="bench-work-row__item-more">
              {benchWorkCopy.row.itemsMore(hiddenItemCount)}
            </span>
          )}
        </span>
      </span>

      {work.buyerName === null ? null : (
        <span className="bench-work-row__buyer">{work.buyerName}</span>
      )}

      {/* Demoted, never deleted. Parcel, counts, the order reference and then
          the work id in mono - the two values a packer reads out on the phone. */}
      <span className="bench-work-row__meta" id={metaId}>
        {benchWorkCopy.row.summary({
          parcelIndex: work.parcelIndex,
          parcelTotal: work.parcelTotal,
          lineCount: work.lineCount,
          unitsToVerify: work.unitsToVerify,
        })}
        {' · '}
        <span className="mono bench-work-row__reference" title={work.orderReference}>
          {work.orderReference}
        </span>
        {' · '}
        <span className="mono">{work.workId}</span>
        {/* #3341, ADR-074. In the meta rather than in a second badge: the
            mockup carries one badge per row, and the section this row sits in
            already names the same fact. */}
        {work.assignmentState === 'mine' ? <> · {benchWorkCopy.row.assignedToYouBadge}</> : null}
        {work.assignmentState === 'assigned-other' ? (
          <> · {benchWorkCopy.row.assignedToOtherBadge}</>
        ) : null}
      </span>

      {work.state === 'held' ? (
        <span className="bench-work-row__note">{benchWorkCopy.row.heldBody}</span>
      ) : null}
      {work.state === 'cancelled' ? (
        <span className="bench-work-row__note">{benchWorkCopy.row.cancelledBody}</span>
      ) : null}
    </>
  );

  const openable = onOpenParcel !== undefined && work.claimable;
  const showExpedite = canExpedite && expediteAction !== null;
  const showClaim = onClaim !== undefined && work.assignmentState === 'unassigned';

  return (
    <li
      className={[
        'bench-work-row',
        `bench-work-row--${work.state}`,
        work.assignmentState === 'mine' ? 'bench-work-row--mine' : null,
        work.assignmentState === 'unassigned' ? 'bench-work-row--open' : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' ')}
      data-testid="bench-work-row"
      data-work-id={work.workId}
      // The mockup's own active-row marker. Written on every row so the
      // absence is explicit rather than inferred from a missing attribute.
      aria-current={active}
      // #3341, ADR-074 — the distinct, test-queryable marker for the three
      // pre-assignment states. Present on every row, including `unassigned`,
      // so a change of value is always observable even where no badge renders.
      data-assignment-state={work.assignmentState}
    >
      {openable ? (
        <button
          type="button"
          className="bench-work-row__surface"
          // Says what the gesture DOES. Without it the accessible name is the
          // whole card read aloud, which is what the mockup's own row would
          // have produced and is no use to anyone.
          aria-label={benchWorkCopy.row.openAction}
          aria-describedby={metaId}
          onClick={() => {
            onOpenParcel(work.workId);
          }}
        >
          {body}
        </button>
      ) : (
        <div className="bench-work-row__surface bench-work-row__surface--static">
          {body}
          {onOpenParcel === undefined ? null : (
            // Convenience only — see the module docblock. A packer sees why the
            // control is gone rather than a control that would refuse them.
            <span className="bench-work-row__locked-note text-muted">
              {benchWorkCopy.row.lockedForOther}
            </span>
          )}
        </div>
      )}

      {showExpedite || showClaim ? (
        <div className="bench-work-row__actions">
          {/* Offered only when the SERVER says the verb is legal, and only to a
              session that may write. A packer sees the badge and no control. */}
          {showExpedite && expediteAction !== null ? (
            <Button
              tone="ghost"
              disabled={expediting}
              onClick={() => {
                onExpedite(work, expediteAction);
              }}
            >
              {expediteAction === 'expedite'
                ? benchWorkCopy.row.expediteAction
                : benchWorkCopy.row.releaseExpediteAction}
            </Button>
          ) : null}
          {showClaim && onClaim !== undefined ? (
            <Button
              tone="secondary"
              disabled={claiming}
              onClick={() => {
                onClaim(work);
              }}
            >
              {benchWorkCopy.tabs.claimAction}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
