/**
 * The item in the packer's hand (mockup-parity epic #3401)
 *
 * `docs/plans/mockups/pack-bench-redesign.html`'s `.hero-line`: the ONE line
 * this box is waiting for next, lifted out of the list and given the whole
 * width of the pane — image, name, attributes, identifiers, bin code, a
 * visible scan field, the hand-confirm path, undo, and the count.
 *
 * ## Why a hero at all, when the list below already renders every line
 *
 * A packer works one item at a time with a scanner in one hand. Before this,
 * the surface showed only a flat list of equal rows and no scan field at all —
 * the scanner listener was on the document, invisible, so a bench with a
 * keyboard-wedge reader looked like a screen with nothing to type into and a
 * bench with a broken reader had no way in at all. The hero is where the
 * gesture actually happens.
 *
 * ## The active line is DERIVED, never stored
 *
 * There is no "current line" on the wire and none in this feature's state:
 * the hero is the first line whose units are not all in the box, in the order
 * the server sent them. A stored cursor would be a second answer to "what is
 * next" that could disagree with the counts — and the counts are the ones the
 * server enforces.
 *
 * ## Typing here goes through the SAME submission path as a scan (D20)
 *
 * `onScanValue` hands the typed string to the parcel view's own matcher — the
 * identical function the document-level scanner listener calls, minting an
 * identical gesture id and sending an identical request. `onConfirm` is the
 * same `submit` the per-line "Confirm this line" button already uses. So this
 * component adds a visible way in and NOT a second way in: nothing here can
 * record a unit the two existing paths could not, and nothing recorded
 * through it is distinguishable afterwards, which is D20 by construction.
 *
 * ## Nothing here claims the item is on a shelf
 *
 * The bin code is operator-authored master data and is labelled as a location
 * to look in, never as stock OpenLinker has confirmed. Same rule as the line
 * rows (#3402/#3410).
 *
 * @module apps/web/src/features/bench/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import type { BenchParcelLine } from '../api/bench-parcel.types';
import { benchParcelCopy } from '../lib/bench-parcel.copy';

export interface BenchParcelHeroProps {
  /** The line this box is waiting for next. Derived by the caller. */
  readonly line: BenchParcelLine;
  /** Whether the box may still take units. A closed or refused box offers none. */
  readonly open: boolean;
  /** H1 — a bench that cannot reach OpenLinker must not look as if it can. */
  readonly unreachable: boolean;
  /** Gestures out and unanswered for THIS line (#2421, story H2). */
  readonly pendingCount: number;
  /** Hands a typed or scanned value to the parcel view's own matcher. */
  readonly onScanValue: (value: string) => void;
  /** E4's path, unchanged — the same `submit` the per-line button calls. */
  readonly onConfirm: (line: BenchParcelLine) => void;
  /** #3405's single undo, offered here because this is where the scan happens. */
  readonly onUndo?: () => void;
  readonly undoing?: boolean;
}

export function BenchParcelHero({
  line,
  open,
  unreachable,
  pendingCount,
  onScanValue,
  onConfirm,
  onUndo,
  undoing = false,
}: BenchParcelHeroProps): ReactElement {
  const [typed, setTyped] = useState('');

  const remaining = Math.max(0, line.requiredQuantity - line.verifiedQuantity);
  const attributes =
    line.attributes === null || Object.keys(line.attributes).length === 0
      ? null
      : benchParcelCopy.lines.attributesText(line.attributes);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = typed.trim();
    if (value.length === 0) return;
    setTyped('');
    onScanValue(value);
  };

  return (
    <section className="bench-hero" data-testid="bench-parcel-hero">
      {line.imageUrl === null ? (
        <div className="bench-hero__swatch" aria-hidden="true" />
      ) : (
        <img className="bench-hero__swatch" src={line.imageUrl} alt="" />
      )}

      <div className="bench-hero__body">
        <p className="bench-hero__name">{line.name ?? benchParcelCopy.lines.unnamed}</p>
        {attributes === null ? null : <p className="bench-hero__attrs">{attributes}</p>}

        <p className="bench-hero__ids">
          {benchParcelCopy.lines.codes({ ean: line.ean, sku: line.sku })}
          {line.binCode === null ? null : (
            <> · {benchParcelCopy.lines.binCodeLabel(line.binCode)}</>
          )}
        </p>

        {/* Nothing below is offered on a box that cannot take units — a
            disabled-looking field on a closed box invites a packer to keep
            scanning into something that records nothing. */}
        {open ? (
          <>
            <form className="bench-hero__scan" onSubmit={handleSubmit}>
              <label htmlFor="bench-hero-scan" className="sr-only">
                {benchParcelCopy.hero.scanLabel}
              </label>
              <input
                id="bench-hero-scan"
                type="text"
                className="mono"
                autoComplete="off"
                placeholder={benchParcelCopy.hero.scanPlaceholder}
                value={typed}
                disabled={unreachable}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
              />
              <Button
                tone="secondary"
                disabled={unreachable}
                onClick={() => {
                  onConfirm(line);
                }}
              >
                {benchParcelCopy.hero.confirmAction}
              </Button>
              {onUndo === undefined ? null : (
                <Button
                  tone="ghost"
                  disabled={undoing || unreachable}
                  onClick={() => {
                    onUndo();
                  }}
                >
                  {benchParcelCopy.hero.undoAction}
                </Button>
              )}
            </form>

            <p className="bench-hero__hint">{benchParcelCopy.hero.scanHint}</p>
            <p className="bench-hero__keys">{benchParcelCopy.hero.keyboardHint}</p>
          </>
        ) : null}
      </div>

      <div className="bench-hero__count">
        <p className="bench-hero__count-value">
          {line.verifiedQuantity}
          <span className="bench-hero__count-of">
            {' '}
            {benchParcelCopy.hero.countOf(line.requiredQuantity)}
          </span>
        </p>
        <p className="bench-hero__count-label">
          {remaining === 0
            ? benchParcelCopy.lines.allIn
            : benchParcelCopy.lines.stillToScan(remaining)}
        </p>
        {/* H2's per-line in-flight marker, in words — same rule as the row. */}
        {pendingCount > 0 ? (
          <p className="bench-hero__pending">{benchParcelCopy.inFlight.sent}</p>
        ) : null}
      </div>
    </section>
  );
}
