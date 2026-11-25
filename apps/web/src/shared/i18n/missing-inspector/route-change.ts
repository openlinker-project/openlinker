/**
 * Route change detection for the missing-translation inspector (#4017)
 *
 * Development-only, like the rest of `missing-inspector`. Patches
 * `history.pushState` / `history.replaceState` and listens to `popstate`, so a
 * route change is seen before the new screen renders, not after: the reads the
 * new screen makes must not be cleared together with the old screen's. Only a
 * change of pathname counts; a search or hash change on the same page does
 * not. The patches stay for the life of the page.
 *
 * @module shared/i18n/missing-inspector
 */
export function onPathnameChange(listener: () => void): void {
  let pathname = window.location.pathname;
  const check = (): void => {
    if (window.location.pathname === pathname) return;
    pathname = window.location.pathname;
    listener();
  };
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History['pushState']>): void => {
      original(...args);
      check();
    };
  }
  window.addEventListener('popstate', check);
}
