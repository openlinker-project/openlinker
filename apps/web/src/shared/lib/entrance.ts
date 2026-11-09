/**
 * Content entrance (#4029)
 *
 * Decides when the app plays its one content entrance: the first page after
 * signing in, or the first page of a new browser session (a new tab). The
 * animation itself is CSS (`.shell--intro` and `.reveal-stagger` in
 * index.css); this only remembers, per tab, that it has played, so moving
 * around the app afterwards stays quick.
 *
 * Storage can be unavailable (a private window, blocked site data): then the
 * entrance simply does not play, which is the safe direction.
 *
 * @module shared/lib
 */

const PLAYED_KEY = 'openlinker.entrance-played';

/** True when this tab has not played the entrance yet. */
export function shouldPlayEntrance(): boolean {
  try {
    return window.sessionStorage.getItem(PLAYED_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markEntrancePlayed(): void {
  try {
    window.sessionStorage.setItem(PLAYED_KEY, '1');
  } catch {
    // Storage unavailable: nothing to remember, nothing will replay either.
  }
}

/** A fresh sign-in plays the entrance again, even in the same tab. */
export function resetEntrance(): void {
  try {
    window.sessionStorage.removeItem(PLAYED_KEY);
  } catch {
    // Storage unavailable: the entrance does not play at all.
  }
}
