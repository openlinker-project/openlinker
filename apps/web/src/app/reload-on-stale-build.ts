/**
 * Reload on a stale build
 *
 * Route pages are code-split, and Vite content-hashes every chunk. A tab that
 * loaded the app before a deploy still holds the OLD index, so the first time
 * it navigates to a page it has not opened yet it asks for a chunk the new
 * build no longer has. nginx answers 404 (an HTML page), the import fails, and
 * the router shows "error loading dynamically imported module" - the operator
 * did nothing wrong and the app looks broken.
 *
 * Vite reports the failed import as a `vite:preloadError` window event. The
 * cure is a fresh index, so reload once. The timestamp guard stops a loop when
 * the failure is NOT a stale build (the server is down, the chunk is really
 * missing): a second failure inside the window is left to the router's error
 * screen instead of reloading for ever.
 *
 * @module apps/web/src/app
 */

/** Session key holding when the last stale-build reload happened. */
export const STALE_BUILD_RELOAD_KEY = 'ol.staleBuildReloadAt';

/** A second failure within this window is a real error, not a stale build. */
export const STALE_BUILD_RELOAD_WINDOW_MS = 10_000;

export interface StaleBuildReloadDeps {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly now: () => number;
  readonly reload: () => void;
}

/**
 * Decides whether a failed chunk import should reload the page, and records
 * the reload. Returns true when it reloaded.
 */
export function reloadOnceForStaleBuild({ storage, now, reload }: StaleBuildReloadDeps): boolean {
  let last = 0;
  try {
    last = Number(storage?.getItem(STALE_BUILD_RELOAD_KEY) ?? 0) || 0;
  } catch {
    // Storage unavailable (private mode, blocked): still reload once per load.
  }
  const at = now();
  if (at - last < STALE_BUILD_RELOAD_WINDOW_MS) {
    // A second failure this soon is not a stale build, and the router's error
    // screen alone would leave a persistently broken deploy invisible in the
    // console. The web app has no shared logger; console.warn is its channel.
    console.warn(
      `Stale-build reload suppressed: a chunk failed to load again ${at - last} ms after the last reload.`,
    );
    return false;
  }
  try {
    storage?.setItem(STALE_BUILD_RELOAD_KEY, String(at));
  } catch {
    // As above: the guard is best-effort, the reload is what matters.
  }
  reload();
  return true;
}

/**
 * Installs the `vite:preloadError` listener once, at boot.
 *
 * `pendingHref` is where the router was GOING: a data router commits the URL
 * only after the page's chunk loads, so a plain reload would land the operator
 * back on the page they were leaving instead of the one they clicked.
 */
export function installStaleBuildReload(
  pendingHref: () => string | null = () => null,
  target: Window = window,
): void {
  target.addEventListener('vite:preloadError', (event) => {
    let storage: Storage | null = null;
    try {
      storage = target.sessionStorage;
    } catch {
      storage = null;
    }
    const reloaded = reloadOnceForStaleBuild({
      storage,
      now: () => Date.now(),
      reload: () => {
        const href = pendingHref();
        if (href) target.location.assign(href);
        else target.location.reload();
      },
    });
    // Reloading: keep the failure from reaching the router's error screen
    // for the instant before the page goes away.
    if (reloaded) event.preventDefault();
  });
}
