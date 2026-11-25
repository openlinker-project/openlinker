/**
 * Route change detection - unit tests (#4017)
 *
 * The inspector clears the "read on this screen" list on a route change, so a
 * missed change keeps the previous screen's keys in the panel and a spurious
 * one empties it while the operator is still on the page.
 *
 * The patches it installs stay on `history` for the rest of the file, as they
 * stay for the life of the page; each test therefore uses paths no earlier
 * test visited and checks only its own listener.
 *
 * @module shared/i18n/missing-inspector
 */
import { describe, expect, it, vi } from 'vitest';

import { onPathnameChange } from './route-change';

describe('onPathnameChange', () => {
  it('should call the listener once for each new pathname reached by pushState or replaceState', () => {
    window.history.replaceState(null, '', '/orders');
    const listener = vi.fn();
    onPathnameChange(listener);

    window.history.pushState(null, '', '/products');
    expect(listener).toHaveBeenCalledTimes(1);

    window.history.replaceState(null, '', '/returns');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('should ignore a change of search or hash on the same page', () => {
    window.history.replaceState(null, '', '/customers');
    const listener = vi.fn();
    onPathnameChange(listener);

    window.history.pushState(null, '', '/customers?page=2');
    window.history.replaceState(null, '', '/customers?page=2#row-5');

    expect(listener).not.toHaveBeenCalled();
  });

  it('should see a back navigation through popstate', async () => {
    window.history.replaceState(null, '', '/settings');
    const listener = vi.fn();
    onPathnameChange(listener);
    window.history.pushState(null, '', '/settings/packing');
    listener.mockClear();

    const popped = new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
    });
    window.history.back();
    await popped;

    expect(window.location.pathname).toBe('/settings');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
