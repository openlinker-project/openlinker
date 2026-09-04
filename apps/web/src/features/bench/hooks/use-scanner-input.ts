/**
 * Scanner input (#2416, `W3b-3`, spec § 2.3)
 *
 * The primitive Surfaces D and E consume: it listens for a barcode scanner
 * anywhere on the bench, WITHOUT needing a focused input, and hands each
 * completed gesture to its consumer with an id that is already durable.
 *
 * ## Why a document listener rather than an input
 *
 * Story C1: every step of verifying a parcel is reachable by scanning, with no
 * target smaller than a gloved fingertip. A packer holding a box in one hand
 * does not first click into a field, and a surface that requires it has a
 * focus bug waiting for the first time something else steals focus. So the
 * listener is on `document` and the surface needs no focused element at all.
 *
 * ## What it deliberately does NOT do
 *
 * It never calls `preventDefault` on Enter. A global Enter suppression would
 * break every keyboard-reachable control on the surface — a packer tabbing to
 * "Move to the front" and pressing Enter would find nothing happens — which
 * trades a scanner convenience for an accessibility regression.
 *
 * And it ignores bursts that start inside an editable element, because the one
 * editable element here is the search field that opens a parcel (D11).
 *
 * ## Every completed gesture is reported, recognised or not
 *
 * Story C3: *"an unrecognised scan is reported, never swallowed"*. This hook
 * cannot know what is recognised — that is the consuming surface's question —
 * so it reports the gesture and the surface decides. What the hook guarantees is
 * that a real scan is never silently dropped.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useCallback, useEffect, useRef } from 'react';

import {
  isEditableTarget,
  isScannerBurst,
  isScannerContentKey,
  isScannerTerminator,
  pruneStaleKeystrokes,
  readScannerValue,
  SCANNER_MAX_LENGTH,
  type ScannerKeystroke,
} from '../lib/scanner-gesture';
import { beginGesture, settleGesture } from '../lib/scanner-gesture-log';

/** One completed scan. */
export interface ScannerGesture {
  /** What was scanned. */
  readonly value: string;
  /**
   * Identity for THIS physical gesture, durable before this object exists.
   *
   * Two scans of the same barcode carry two ids and are two units; a retry of
   * one scan reuses its id and is one. See `scanner-gesture-log`.
   */
  readonly gestureId: string;
  readonly at: number;
}

export interface UseScannerInputOptions {
  /** Called once per completed gesture. */
  readonly onScan: (gesture: ScannerGesture) => void;
  /**
   * Whether to listen at all. Default `true`.
   *
   * A surface that is covered — the locked screen, a modal — passes `false`, so
   * a scan made while nobody is signed in is not attributed to the person who
   * walked away.
   */
  readonly enabled?: boolean;
}

export interface UseScannerInputResult {
  /**
   * Forget a gesture once it has been accounted for.
   *
   * Exposed for #2420, which owns sending a gesture and therefore owns knowing
   * when it is settled. Nothing in this slice calls it; the log is bounded so
   * that is safe rather than merely tolerable.
   */
  readonly settle: (gestureId: string) => void;
}

export function useScannerInput({
  onScan,
  enabled = true,
}: UseScannerInputOptions): UseScannerInputResult {
  const buffer = useRef<ScannerKeystroke[]>([]);
  // The callback is read through a ref so the listener is attached once, rather
  // than being torn down and re-attached on every render of the consuming
  // component — a re-attach mid-burst would drop the keys already buffered.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) {
      buffer.current = [];
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      // The search field keeps every key it receives. Checked before the buffer
      // is touched, so typing a buyer's surname cannot leave a fragment behind.
      if (isEditableTarget(event.target)) {
        buffer.current = [];
        return;
      }

      const now = Date.now();

      if (event.key === 'Enter') {
        const keys = buffer.current;
        buffer.current = [];
        // Deliberately no `preventDefault` — see the module docblock.
        //
        // Two checks, not one: the CHARACTERS must read as a burst, and the
        // terminator must have arrived with them. Folding Enter into the buffer
        // would let a three-character fragment satisfy a four-character minimum.
        if (!isScannerBurst(keys)) return;
        if (!isScannerTerminator(keys, now)) return;

        const value = readScannerValue(keys);
        if (value.length === 0) return;

        // Durable BEFORE the consumer sees it. That ordering is the contract.
        const gesture = beginGesture(value, now);
        onScanRef.current({ value, gestureId: gesture.gestureId, at: now });
        return;
      }

      if (!isScannerContentKey(event)) return;

      // Age out anything that cannot belong to the burst in progress, so an
      // abandoned fragment can never prefix a later scan.
      const fresh = pruneStaleKeystrokes(buffer.current, now);
      fresh.push({ char: event.key, at: now });
      // A hard bound as well as the time one: a stuck key emitting inside the
      // gap threshold would otherwise grow this without end.
      //
      // `+ 1`, deliberately. Capping at exactly `SCANNER_MAX_LENGTH` would make
      // `isScannerBurst`'s over-length clause UNREACHABLE from the product: a
      // 129-character burst would arrive as its last 128, pass every clause, and
      // be handed over as a correct value — a scan silently TRUNCATED and then
      // reported as good, which is the worst outcome the primitive can have.
      // Keeping one character past the bound is what lets the terminator refuse
      // it. Anything longer than that is a stuck key rather than a symbology,
      // and is dropped from the front as before.
      buffer.current = fresh.slice(-(SCANNER_MAX_LENGTH + 1));
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      buffer.current = [];
    };
  }, [enabled]);

  const settle = useCallback((gestureId: string) => {
    settleGesture(gestureId);
  }, []);

  return { settle };
}
