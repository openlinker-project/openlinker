/**
 * Release showcase catalog
 *
 * Tour-only items: nothing to configure, just "here is what is new and where".
 * Each showcase has 1 to 3 stops; a stop is a route and a `data-tour` target.
 * Text lives in `locales/{en,pl}/release-center.json` under
 * `showcases.<id>.{title,why,stops.<n>.{title,body}}`, never here.
 * `scripts/check-release-center-catalog.mjs` reads this file textually, so keep
 * each entry's `id` and `introducedIn` as plain string literals and write every
 * stop as one `{ routePattern: '...', target: '...' }` object on its own line.
 *
 * @module features/release-center
 */
import type { ReleaseShowcaseEntry } from './release-step.types';

export const RELEASE_SHOWCASES: readonly ReleaseShowcaseEntry[] = [
  {
    id: 'release-center-tour',
    introducedIn: '0.21.0',
    appliesWhen: () => true,
    stops: [
      { routePattern: 'whats-new', target: 'release-bell' },
      { routePattern: 'whats-new', target: 'whats-new-setup' },
    ],
  },
  // Standalone: no `introducedIn`, so it belongs to no release and is started by id.
  {
    id: 'first-steps',
    appliesWhen: () => true,
    stops: [
      { routePattern: 'orders', target: 'orders-table', follow: { pathPrefix: 'orders', target: 'order-detail' } },
      { routePattern: 'orders', target: 'orders-columns' },
    ],
  },
];
