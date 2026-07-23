/**
 * Viewport test helpers
 *
 * Lightweight, provider-free helpers for driving responsive behaviour in
 * component tests. Kept out of `test-utils.tsx` on purpose so low-level
 * primitive specs (e.g. `shared/ui/data-table.test.tsx`) can force a viewport
 * without dragging the full app provider/plugin harness into their module
 * graph.
 *
 * @module test
 */
import { vi } from 'vitest';

/**
 * Forces `window.matchMedia` to report a mobile viewport so the DataTable's
 * `useMediaQuery('(max-width: 767.98px)')` returns true and the card view (not
 * the table) renders. Returns a `restore()` — call it in a `finally` so the
 * spy never leaks into sibling tests.
 */
export function mockMobileViewport(): { restore: () => void } {
  const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  return { restore: () => spy.mockRestore() };
}
