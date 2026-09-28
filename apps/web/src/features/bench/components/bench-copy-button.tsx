/**
 * Copy one value to the clipboard (mockup-parity epic #3401)
 *
 * The mockup's `.copy-btn` sits beside the order reference and the hero's
 * EAN, and it exists for one situation: a packer with a box in front of them
 * rings the office and has to read an identifier out. Copying it is faster
 * and does not misread a digit.
 *
 * ## Why not `CopyableId` from `shared/ui`
 *
 * That primitive OWNS the value as well as the control — it renders the id
 * inside its own `<code>`, at its own size, and hides the button until hover.
 * Both are wrong here: the order reference is already the loudest thing on
 * the order head at its own weight, the hero's identifiers sit inside a
 * sentence of other codes, and a control that appears on hover is invisible
 * at a bench where nobody hovers. This adds a button NEXT to whatever the
 * caller already renders and touches neither.
 *
 * ## Refusal is silent, and that is deliberate
 *
 * `navigator.clipboard` is absent in an insecure context and can reject on a
 * permission refusal. There is nothing a packer can do about either, the
 * value is on screen to be read anyway, and an error alert on a surface
 * worked at speed trains people to dismiss alerts. The button simply does
 * not confirm.
 *
 * @module apps/web/src/features/bench/components
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { benchParcelCopy } from '../lib/bench-parcel.copy';

export interface BenchCopyButtonProps {
  /** The value copied. Never rendered — the caller already shows it. */
  readonly value: string;
  /** What the value IS, for the accessible name. e.g. `order reference`. */
  readonly what: string;
}

export function BenchCopyButton({ value, what }: BenchCopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(() => {
    // Optional-chained: in an insecure context `clipboard` is undefined, and
    // reading `.writeText` off it would throw where nothing can be done.
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
        timer.current = null;
      }, 1500);
    });
  }, [value]);

  return (
    <button
      type="button"
      className="bench-copy-button"
      aria-label={
        copied ? benchParcelCopy.copy.copied(what) : benchParcelCopy.copy.action(what)
      }
      onClick={copy}
    >
      {/* Decorative: the accessible name above says what the control does. */}
      <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}
