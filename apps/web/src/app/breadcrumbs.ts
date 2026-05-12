/**
 * Breadcrumb resolver
 *
 * Pure helper consumed by `AppShell` to derive the current breadcrumb from
 * the React Router match chain. Each authenticated route module sets
 * `handle: { crumb: { group, title } } satisfies RouteCrumbHandle` and the
 * resolver walks the match list deepest-first, returning the first crumb
 * it finds. When no match carries a crumb, the fallback is the same
 * shape the legacy `resolveCrumbs()` returned for unknown paths.
 *
 * Extracted so the merge logic stays unit-testable without booting the
 * shell or the React Router data-router runtime.
 *
 * @module app
 * @see nav-registry.types.ts — `RouteCrumbHandle` + `isCrumbHandle` guard
 */
import type { useMatches } from 'react-router-dom';

import { isCrumbHandle } from './nav-registry.types';

export const DEFAULT_CRUMB = { group: 'OpenLinker', title: '' } as const;

/**
 * Walk the React Router match chain deepest-first and return the first
 * crumb-shaped `handle`. Falls back to `DEFAULT_CRUMB` when nothing in the
 * chain carries crumb metadata.
 */
export function resolveCrumbFromMatches(
  matches: ReturnType<typeof useMatches>,
): { group: string; title: string } {
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i].handle;
    if (isCrumbHandle(handle)) {
      return handle.crumb;
    }
  }
  // Spread to return a fresh object — `DEFAULT_CRUMB` is `as const`, and we
  // don't want callers to mutate the shared constant by accident.
  return { ...DEFAULT_CRUMB };
}
