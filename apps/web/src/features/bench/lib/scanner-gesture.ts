/**
 * Scanner gesture rules (#2416, `W3b-3`, spec § 2.3)
 *
 * Telling a barcode scanner apart from a person typing, as pure functions over
 * buffered keystrokes. No DOM, no timers, no storage — the hook owns all three.
 *
 * ## Why a rule module rather than logic inside the hook
 *
 * The thresholds below are the whole of "is this a scan", and a threshold
 * buried in an effect is a threshold nobody re-reads. Pure, it is the rule for
 * the type it sits with, and both halves change together — the
 * `engineering-standards.md` pure-rule exception on all three counts.
 *
 * ## What a hardware scanner looks like
 *
 * It presents as a keyboard. It emits the barcode's characters as fast as the
 * USB HID stack will carry them and terminates with Enter. So the rule is:
 * a burst whose every gap is short, of at least a plausible barcode's length,
 * ending in Enter.
 *
 * @module apps/web/src/features/bench/lib
 */

/**
 * The longest gap between two keystrokes that can still be one scan, in ms.
 *
 * 50 ms is roughly 1200 characters per minute sustained. A person cannot hold
 * that over a whole barcode, and a scanner is an order of magnitude faster
 * still, so the threshold sits in a wide empty band rather than near either
 * population — which is what stops it needing tuning per device.
 */
export const SCANNER_MAX_KEY_GAP_MS = 50;

/**
 * The shortest burst that can be a barcode.
 *
 * Below this, a fast two- or three-key flourish followed by Enter — plausible
 * on a form — would register as a scan. Every real symbology this bench will
 * meet is longer.
 */
export const SCANNER_MIN_LENGTH = 4;

/**
 * The longest burst that will be accepted, in characters.
 *
 * A bound rather than a symbology limit: without one, a stuck key or a device
 * emitting a continuous sub-threshold stream grows the buffer without end for
 * as long as the tab is open. Generous enough that no real code is truncated.
 */
export const SCANNER_MAX_LENGTH = 128;

/**
 * The longest a single burst may take from first key to terminator, in ms.
 *
 * The per-gap threshold alone does not bound a burst: a chain of keys each 49 ms
 * apart never trips it and never ends. This is the second bound, and it is what
 * makes "a scan" a bounded event rather than an open-ended accumulation.
 */
export const SCANNER_MAX_BURST_MS = 1000;

/** One buffered keystroke: the character it produced and when it arrived. */
export interface ScannerKeystroke {
  readonly char: string;
  readonly at: number;
}

/**
 * Is this key one a scanner would have produced?
 *
 * Exactly one printable character, with no modifier held. A modifier means a
 * human reaching for a shortcut, and a multi-character `key` (`Shift`, `Tab`,
 * `ArrowLeft`, a dead key) is not content. Both are IGNORED rather than
 * buffered — buffering them would let a keyboard shortcut appear inside a
 * barcode, and discarding the buffer on them would let an incidental key press
 * mid-scan silently swallow a real one.
 */
export function isScannerContentKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1;
}

/**
 * Does this buffer read as a scan rather than typing?
 *
 * Every clause must hold. A buffer failing any of them is discarded silently as
 * typing: reporting it would make every Enter pressed anywhere on the surface an
 * "unrecognised scan", and story C3's alarm has to mean something.
 *
 * **The terminator is NOT part of the buffer**, and that separation is load-
 * bearing rather than tidy: counting Enter toward `SCANNER_MIN_LENGTH` makes the
 * minimum one character weaker than it reads, so a three-character fragment
 * followed by Enter passes a rule that says four. The terminator's own timing is
 * checked by `isScannerTerminator` instead.
 */
export function isScannerBurst(keys: readonly ScannerKeystroke[]): boolean {
  if (keys.length < SCANNER_MIN_LENGTH) return false;
  if (keys.length > SCANNER_MAX_LENGTH) return false;

  const first = keys[0];
  const last = keys[keys.length - 1];
  if (last.at - first.at > SCANNER_MAX_BURST_MS) return false;

  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i].at - keys[i - 1].at > SCANNER_MAX_KEY_GAP_MS) return false;
  }
  return true;
}

/**
 * Did the terminator arrive as part of the same burst?
 *
 * A scanner sends Enter at the same speed as the characters before it. An Enter
 * that arrives later belongs to a person — most likely one who typed into the
 * surface, paused, and pressed it — so the buffer before it is not a scan
 * however fast those characters were.
 */
export function isScannerTerminator(
  keys: readonly ScannerKeystroke[],
  terminatorAt: number
): boolean {
  if (keys.length === 0) return false;
  return terminatorAt - keys[keys.length - 1].at <= SCANNER_MAX_KEY_GAP_MS;
}

/** The scanned value a buffer carries. */
export function readScannerValue(keys: readonly ScannerKeystroke[]): string {
  return keys.map((key) => key.char).join('');
}

/**
 * Drop keystrokes too old to belong to the burst in progress.
 *
 * Called before each new key rather than on a timer: a burst that never
 * terminates simply ages out of the buffer as the next one starts, so a scanner
 * unplugged mid-code cannot leave a fragment that later prefixes a real scan.
 */
export function pruneStaleKeystrokes(
  keys: readonly ScannerKeystroke[],
  now: number
): ScannerKeystroke[] {
  const fresh: ScannerKeystroke[] = [];
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const next = fresh.length > 0 ? fresh[0].at : now;
    if (next - keys[i].at > SCANNER_MAX_KEY_GAP_MS) break;
    fresh.unshift(keys[i]);
  }
  return fresh;
}

/**
 * Should keystrokes originating here be left alone?
 *
 * The bench's one editable element is the search field that opens a parcel
 * (decision D11 — OpenLinker prints no barcode, so opening is search-and-select
 * and cannot be a scan). Stealing its keystrokes would break the one input the
 * surface has. So a burst that starts inside an editable element is not a
 * gesture, and the field keeps every key.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
