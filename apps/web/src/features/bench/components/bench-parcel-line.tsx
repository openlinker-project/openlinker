/**
 * One line of one box (#2418, `W3b-5`, stories E1/E3/E4, D20)
 *
 * ## A hand-confirmed line is INDISTINGUISHABLE from a scanned one (D20)
 *
 * Not by convention — this component has **no input that could tell them
 * apart**. Its props are the line, whether it is the one being scanned, and the
 * confirm callback; nothing carries how a unit arrived, because nothing upstream
 * carries it either. `VerifyUnitDto` names a LINE and a gesture, so the parcel
 * read that feeds this component has no provenance field to render, and there is
 * no branch here that could grow one without also inventing the data.
 *
 * That matters more than it looks. D20's reasoning is that marking a manual
 * confirmation creates a stigma, and stigma drives the workaround the system
 * cannot detect: the packer scans a second unit of the same code twice, and the
 * box closes looking perfectly verified. A badge saying "confirmed by hand" is
 * the cheapest possible change to this file and the most expensive one to the
 * warehouse, so the absence is asserted by
 * `bench-parcel.test.tsx` comparing the rendered markup of the two paths
 * byte for byte.
 *
 * `pendingCount` (#2421) does not weaken that. It is keyed by LINE, and a scan
 * and a hand-confirm both increment it through the same call — so the in-flight
 * marker is one more thing the two paths render identically, not the first
 * thing that tells them apart.
 *
 * ## State is written in WORDS, never in colour alone
 *
 * The count, the remaining-units phrase and the badge are all text, following
 * `BenchWorkRow`'s rule. The tint is an addition to that.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { BenchParcelLine } from '../api/bench-parcel.types';
import { narrowAttributes } from '../lib/bench-parcel-attributes';
import { benchLineState, type BenchLineState } from '../lib/bench-parcel-presentation';
import { benchParcelCopy } from '../lib/bench-parcel.copy';
import { BenchThumb } from './bench-thumb';

export interface BenchParcelLineRowProps {
  readonly line: BenchParcelLine;
  /**
   * The attribute keys that differ across THIS parcel's lines, from
   * `distinguishingAttributeKeys`. Computed once by the parent, because it is a
   * property of the box's contents rather than of any one row.
   */
  readonly distinguishingAttributes: ReadonlySet<string>;
  /**
   * Whether any line in this box carries a bin code. False collapses the
   * Location column for the whole table — see `bench-parcel.tsx`, which owns
   * the decision because it is a fact about the box, not about one row.
   */
  readonly hasBins: boolean;
  /** Whether the box is still open. A closed box offers no confirm control. */
  readonly open: boolean;
  /** E4's path. Sends exactly what a scan sends. */
  readonly onConfirm: (line: BenchParcelLine) => void;
  /**
   * How many gestures for THIS line are out and unanswered (#2421, story H2).
   *
   * Rendered BESIDE the count, never inside it. `verifiedQuantity` stays the
   * server's own number and `benchLineState` never sees this value, so a line
   * cannot read `Verified` on the strength of a request that is still in the
   * air — which is the whole of H2's first half. What it adds is the second
   * half: the packer can see that their scan is on its way rather than looking
   * at a screen that did not move.
   *
   * A COUNT rather than a boolean because a two-unit line legitimately has two
   * gestures out at once, and "waiting" would understate it.
   */
  readonly pendingCount?: number;
  /**
   * Whether the bench can reach OpenLinker (#2421, story H1). A confirm control
   * that could only fail is worse than one that says why it is unavailable.
   */
  readonly unreachable?: boolean;
}

const BADGE_TONE: Readonly<Record<BenchLineState, StatusBadgeTone>> = {
  verified: 'success',
  'in-progress': 'info',
  'not-started': 'neutral',
};

const BADGE_TEXT: Readonly<Record<BenchLineState, string>> = {
  verified: benchParcelCopy.lines.badgeVerified,
  'in-progress': benchParcelCopy.lines.badgeScanning,
  'not-started': benchParcelCopy.lines.badgeNotScanned,
};

export function BenchParcelLineRow({
  line,
  distinguishingAttributes,
  hasBins,
  open,
  onConfirm,
  pendingCount = 0,
  unreachable = false,
}: BenchParcelLineRowProps): ReactElement {
  const state = benchLineState(line);
  const pending = pendingCount > 0;
  const remaining = Math.max(0, line.requiredQuantity - line.verifiedQuantity);
  const codes = benchParcelCopy.lines.codes({ ean: line.ean, sku: line.sku });
  const visibleAttributes = narrowAttributes(line.attributes, distinguishingAttributes);

  return (
    <li
      className={`bench-parcel-line bench-parcel-line--${state}${
        pending ? ' bench-parcel-line--pending' : ''
      }${hasBins ? '' : ' bench-parcel-line--no-bins'}`}
      data-testid="bench-parcel-line"
      data-line-id={line.workLineId}
    >
      {/* #3410/#3417 (epic #3401) — the parent product's image. Purely
          decorative identity, so it carries no accessible name of its own;
          `line.name` beside it already announces the product. */}
      {/* The cell is ALWAYS present, even with no image. Rendering `null` here
          removed the element entirely, so every later cell auto-placed one
          column to the left and the whole row stood off the column headings
          above it — invisible until a line happened to carry a picture. */}
      <BenchThumb
        className="bench-parcel-line__thumb"
        imageUrl={line.imageUrl}
        name={line.name}
        testId="bench-parcel-line-thumb"
      />

      {/* ITEM — the mockup's first column: name, then the variant's own
          distinguishing attributes under it. */}
      <div className="bench-parcel-line__identity">
        <span className="bench-parcel-line__name">
          {line.name ?? benchParcelCopy.lines.unnamed}
        </span>
        {visibleAttributes === null ? null : (
          <span className="bench-parcel-line__attributes">
            {benchParcelCopy.lines.attributesText(visibleAttributes)}
          </span>
        )}
        {line.weightGrams === null && line.lengthMm === null ? null : (
          <span className="bench-parcel-line__physical">
            {line.weightGrams === null ? null : (
              <span>{benchParcelCopy.lines.weightGrams(line.weightGrams)}</span>
            )}
            {line.lengthMm === null || line.widthMm === null || line.heightMm === null ? null : (
              <span>
                {benchParcelCopy.lines.dimensionsMm(line.lengthMm, line.widthMm, line.heightMm)}
              </span>
            )}
          </span>
        )}
      </div>

      {/* IDENTIFIERS — its own column in the mockup, so a packer's eye runs
          down one list of codes rather than hunting inside each card. */}
      <div className="bench-parcel-line__codes">{codes.length === 0 ? null : codes}</div>

      {/* LOCATION — where to LOOK, never a claim that the unit is there. */}
      <div className="bench-parcel-line__location">
        {line.binCode === null ? null : (
          <span className="bench-parcel-line__bin-code">
            {benchParcelCopy.lines.binCodeLabel(line.binCode)}
          </span>
        )}
      </div>

      <div className="bench-parcel-line__count">
        <span className="bench-parcel-line__count-value">
          {benchParcelCopy.lines.count(line.verifiedQuantity, line.requiredQuantity)}
        </span>
        {/* Only where it says something the badge to the right does not.
            A not-started row rendered `not scanned yet` here AND
            `Not scanned yet` as its badge — the same four words twice on one
            row, on the densest part of the screen; a verified row said
            `all in` beside `Verified`, which is the same fact reworded. The
            remaining count on a part-scanned row is the one case the badge
            cannot carry, and the mockup's own quantity cell holds nothing
            but `X of Y` for the other two. */}
        {state === 'in-progress' && remaining > 0 ? (
          <span className="bench-parcel-line__count-note">
            {benchParcelCopy.lines.stillToScan(remaining)}
          </span>
        ) : null}
      </div>

      <div className="bench-parcel-line__state">
        <StatusBadge tone={BADGE_TONE[state]} withDot={state !== 'not-started'}>
          {BADGE_TEXT[state]}
        </StatusBadge>
        {/* H2. A SECOND badge beside the state badge, never a fourth value of
            it: the state badge answers "what has the system counted", and a
            gesture in the air has not changed that answer. Written in words —
            no spinner, no tint on its own — so a packer who cannot make out
            colour still reads it, and so `bench-parcel-line.test.tsx` can
            assert it from `textContent`. */}
        {pending ? (
          <span className="bench-parcel-line__pending" data-testid="bench-parcel-line-pending">
            {benchParcelCopy.inFlight.sent}
            {pendingCount > 1 ? ` (${String(pendingCount)})` : ''}
          </span>
        ) : null}
      </div>

      <div className="bench-parcel-line__actions">
        {/* E4. Offered only while the box is open and the line has room — a
            control that could only be refused is worse than none on a surface
            worked at speed. */}
        {open && state !== 'verified' ? (
          <>
            <Button
              tone="secondary"
              // The VISIBLE text is the same four words on every row and on the
              // hero, because they are the same act. The accessible name is
              // not: a row confirms THIS item while the hero confirms whichever
              // item the box is waiting for next, so leaving both announced as
              // "Confirm this item" gives a screen-reader user several
              // identically-named buttons that do different things. Naming the
              // product resolves that without putting a second word on screen.
              // (Until the wording was unified, the two were told apart only by
              // "line" versus "item" — an accident, not a decision.)
              aria-label={
                line.name === null
                  ? undefined
                  : benchParcelCopy.lines.confirmActionFor(line.name)
              }
              // Deliberately NOT disabled while a gesture is out (#2905
              // review). The mutation observer is shared by every line, so
              // `verify.isPending` greyed line B out because line A was in
              // flight — and it made the manual path blockable where the scan
              // path never is, the asymmetry D20 argues against. A second press
              // mints a second gesture id and is therefore exactly a second
              // scan, which the server's own over-pack guard adjudicates.
              disabled={unreachable}
              onClick={() => {
                onConfirm(line);
              }}
            >
              {benchParcelCopy.lines.confirmAction}
            </Button>
            {/* H1. Shown-and-refused rather than hidden: a control that
                vanishes reads as a missing feature, and the packer's next move
                is to hunt for it. Saying why is what stops that. */}
            {unreachable ? (
              <span className="bench-parcel-line__confirm-hint">
                {benchParcelCopy.unreachable.confirmDisabledHint}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
}
