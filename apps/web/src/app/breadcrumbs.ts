/**
 * Breadcrumb resolver
 *
 * Pure helper consumed by `AppShell` to derive the current breadcrumb from
 * the React Router match chain. Each authenticated route module sets
 * `handle: { crumb: { group, page } } satisfies RouteCrumbHandle` and the
 * resolver walks the match list deepest-first, returning the first crumb
 * it finds, with its section and page keys read from the `app` namespace.
 * When no match carries a crumb, the fallback is the brand name with no
 * title, the shape the legacy `resolveCrumbs()` returned for unknown paths.
 *
 * Extracted so the merge logic stays unit-testable without booting the
 * shell or the React Router data-router runtime.
 *
 * @module app
 * @see nav-registry.types.ts — `RouteCrumbHandle` + `isCrumbHandle` guard
 */
import type { useMatches } from 'react-router-dom';

import { getMessages } from '../shared/i18n';
import type { AppCopy } from './nav-registry';
import { isCrumbHandle } from './nav-registry.types';

export interface ResolvedCrumb {
  group: string;
  title: string;
}

function lookupKey(labels: Readonly<Record<string, string>>, key: string): string {
  const label = Object.hasOwn(labels, key) ? labels[key] : undefined;
  if (label !== undefined) return label;
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
    console.warn(`Breadcrumb key "${key}" is not in the app namespace; showing it as written.`);
  }
  return key;
}

/**
 * Walk the React Router match chain deepest-first and return the first
 * crumb-shaped `handle`. Falls back to the brand name when nothing in the
 * chain carries crumb metadata.
 */
export function resolveCrumbFromMatches(
  matches: ReturnType<typeof useMatches>,
  copy: AppCopy = getMessages('app'),
): ResolvedCrumb {
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i].handle;
    if (isCrumbHandle(handle)) {
      const { crumb } = handle;
      // `isCrumbHandle` checks only that the values are strings, so a crumb
      // that skipped `satisfies RouteCrumbHandle` (or a plugin still writing
      // the English label) can name a key that does not exist. Show what it
      // wrote rather than an empty crumb.
      return {
        group: lookupKey(copy.sections, crumb.group),
        title: 'page' in crumb ? lookupKey(copy.pages, crumb.page) : crumb.title,
      };
    }
  }
  return { group: copy.brand.name, title: '' };
}
