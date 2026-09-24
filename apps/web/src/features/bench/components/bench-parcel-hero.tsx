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
 * same `submit` the per-row "Confirm this item" button already uses. So this
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
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BenchParcelLine } from '../api/bench-parcel.types';
import { isEditableTarget } from '../lib/scanner-gesture';
import { narrowAttributes } from '../lib/bench-parcel-attributes';
import { benchParcelCopy } from '../lib/bench-parcel.copy';
import { BenchCopyButton } from './bench-copy-button';
import { BenchThumb } from './bench-thumb';

export interface BenchParcelHeroProps {
  /** The line this box is waiting for next. Derived by the caller. */
  readonly line: BenchParcelLine;
  /**
   * The attribute keys that differ across this parcel's lines. See
   * `bench-parcel-attributes.ts` — the hero narrows to the same subset the
   * table does, so one item does not read two different ways on one screen.
   */
  readonly distinguishingAttributes: ReadonlySet<string>;
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
  distinguishingAttributes,
  open,
  unreachable,
  pendingCount,
  onScanValue,
  onConfirm,
  onUndo,
  undoing = false,
}: BenchParcelHeroProps): ReactElement {
  const [typed, setTyped] = useState('');
  const field = useRef<HTMLInputElement | null>(null);
  /** The mockup's transient `✓ Matched`, cleared on the next gesture. */
  const [matched, setMatched] = useState(false);
  const seen = useRef(line.verifiedQuantity);

  // The mockup's `Esc back to the scan box`. Bound here because this is the
  // component that owns the field; anywhere else would need a ref handed
  // across a boundary for one key.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // An editable target is the whole point here — Esc is FOR getting back
      // to the field — so `isEditableTarget` is used to skip only the field
      // itself, which is already focused.
      if (field.current !== null && event.target === field.current) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      field.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Fires on the SERVER's count moving, never on the gesture being sent —
  // the badge must mean "that one landed", which is the whole of H2's rule.
  useEffect(() => {
    if (line.verifiedQuantity <= seen.current) {
      seen.current = line.verifiedQuantity;
      return;
    }
    seen.current = line.verifiedQuantity;
    setMatched(true);
    const t = setTimeout(() => {
      setMatched(false);
    }, 1600);
    return () => clearTimeout(t);
  }, [line.verifiedQuantity]);

  const remaining = Math.max(0, line.requiredQuantity - line.verifiedQuantity);
  const visibleAttributes = narrowAttributes(line.attributes, distinguishingAttributes);
  const attributes =
    visibleAttributes === null ? null : benchParcelCopy.lines.attributesText(visibleAttributes);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = typed.trim();
    if (value.length === 0) return;
    setTyped('');
    onScanValue(value);
  };

  return (
    <section className="bench-hero" data-testid="bench-parcel-hero">
      <BenchThumb className="bench-hero__swatch" imageUrl={line.imageUrl} name={line.name} />

      <div className="bench-hero__body">
        <p className="bench-hero__name">{line.name ?? benchParcelCopy.lines.unnamed}</p>
        {attributes === null ? null : <p className="bench-hero__attrs">{attributes}</p>}

        <p className="bench-hero__ids">
          {benchParcelCopy.lines.codes({ ean: line.ean, sku: line.sku })}
          {/* The mockup's copy control, on the value a packer reads out to the
              office when an item will not scan. */}
          {line.ean === null ? null : (
            <BenchCopyButton value={line.ean} what={benchParcelCopy.copy.barcode} />
          )}
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
                ref={field}
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
                  {benchParcelCopy.undo.action}
                </Button>
              )}
            </form>

            <p className="bench-hero__hint">{benchParcelCopy.hero.scanHint}</p>
            <p className="bench-hero__keys">{benchParcelCopy.hero.keyboardHint}</p>
            {/* Transient, and it says only that the count MOVED — the live
                region still carries the number, so this adds reassurance at a
                glance and never a fact of its own. */}
            <p className="bench-hero__feedback">
              {matched ? (
                <StatusBadge tone="success" withDot compact>
                  {benchParcelCopy.hero.matched}
                </StatusBadge>
              ) : null}
            </p>
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
