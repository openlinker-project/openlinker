/**
 * Scanner input hook (#2416, `W3b-3`, spec § 2.3, designed for G3 / #2420)
 *
 * The load-bearing test here is the LAST one: two identical scans must carry two
 * ids. A primitive that deduped on the payload would pass every other test in
 * this file and silently record one unit where a packer scanned two.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listPendingGestures, resetGestureLogForTests } from '../lib/scanner-gesture-log';
import { SCANNER_MAX_KEY_GAP_MS, SCANNER_MAX_LENGTH } from '../lib/scanner-gesture';
import { useScannerInput, type ScannerGesture } from './use-scanner-input';

/** Fire one keystroke at the document, optionally from inside an element. */
function key(char: string, target?: HTMLElement): void {
  const event = new KeyboardEvent('keydown', { key: char, bubbles: true });
  (target ?? document).dispatchEvent(event);
}

/** Type `value` at scanner speed and terminate it. */
function scan(value: string, target?: HTMLElement): void {
  for (const char of value) key(char, target);
  key('Enter', target);
}

describe('useScannerInput (#2416)', () => {
  beforeEach(() => {
    resetGestureLogForTests();
    vi.useRealTimers();
  });

  it('should report a scan with no focused input', () => {
    const onScan = vi.fn();
    renderHook(() => useScannerInput({ onScan }));

    scan('5901234123457');

    expect(onScan).toHaveBeenCalledTimes(1);
    expect((onScan.mock.calls[0][0] as ScannerGesture).value).toBe('5901234123457');
  });

  it('should NOT report typing, which is slower than a scanner', async () => {
    const onScan = vi.fn();
    renderHook(() => useScannerInput({ onScan }));

    // A real pause between two characters is what makes this typing.
    key('4');
    await new Promise((resolve) => setTimeout(resolve, SCANNER_MAX_KEY_GAP_MS + 20));
    key('4');
    key('7');
    key('1');
    key('Enter');

    expect(onScan).not.toHaveBeenCalled();
  });

  it('should leave the search field alone (D11 — opening is typed, not scanned)', () => {
    const onScan = vi.fn();
    renderHook(() => useScannerInput({ onScan }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    scan('5901234123457', input);
    input.remove();

    expect(onScan).not.toHaveBeenCalled();
  });

  it('should never suppress Enter, which would break every keyboard control', () => {
    renderHook(() => useScannerInput({ onScan: vi.fn() }));

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('should not listen while disabled, so a covered surface attributes nothing', () => {
    const onScan = vi.fn();
    renderHook(() => useScannerInput({ onScan, enabled: false }));

    scan('5901234123457');

    expect(onScan).not.toHaveBeenCalled();
  });

  it('should make the gesture id DURABLE BEFORE the consumer is called', () => {
    let pendingAtCallTime: readonly { gestureId: string }[] = [];
    const onScan = vi.fn((gesture: ScannerGesture) => {
      // Read from storage from INSIDE the callback: the contract is that the id
      // is already persisted by the time a consumer can act on it, so a caller
      // crashing here still finds it on the next load.
      pendingAtCallTime = listPendingGestures();
      expect(pendingAtCallTime.some((entry) => entry.gestureId === gesture.gestureId)).toBe(true);
    });
    renderHook(() => useScannerInput({ onScan }));

    scan('5901234123457');

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(pendingAtCallTime).toHaveLength(1);
  });

  it('should REFUSE an over-long burst rather than reporting its last 128 characters', () => {
    // The integrated path, not the unit rule. Capping the buffer at exactly the
    // maximum would make the over-length clause unreachable and hand over a
    // silently truncated value as if it were the code that was scanned.
    const onScan = vi.fn();
    renderHook(() => useScannerInput({ onScan }));

    scan('9'.repeat(SCANNER_MAX_LENGTH + 1));

    expect(onScan).not.toHaveBeenCalled();
  });

  it('should still accept a burst of exactly the maximum length', () => {
    const onScan = vi.fn();
    renderHook(() => useScannerInput({ onScan }));

    scan('9'.repeat(SCANNER_MAX_LENGTH));

    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('should give two identical scans two ids — G3, the second unit of a two-unit line', () => {
    const gestures: ScannerGesture[] = [];
    renderHook(() =>
      useScannerInput({
        onScan: (gesture) => {
          gestures.push(gesture);
        },
      })
    );

    scan('5901234123457');
    scan('5901234123457');

    expect(gestures).toHaveLength(2);
    expect(gestures[0].value).toBe(gestures[1].value);
    // The whole point. Deduping on the payload would collapse these.
    expect(gestures[0].gestureId).not.toBe(gestures[1].gestureId);
    expect(listPendingGestures()).toHaveLength(2);
  });

  it('should let a settled gesture leave the log', () => {
    const gestures: ScannerGesture[] = [];
    const { result } = renderHook(() =>
      useScannerInput({
        onScan: (gesture) => {
          gestures.push(gesture);
        },
      })
    );

    scan('5901234123457');
    expect(listPendingGestures()).toHaveLength(1);

    result.current.settle(gestures[0].gestureId);
    expect(listPendingGestures()).toHaveLength(0);
  });
});
