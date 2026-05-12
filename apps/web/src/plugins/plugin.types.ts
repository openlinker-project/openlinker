/**
 * WebPlugin types
 *
 * Type definitions for the FE build-time plugin registry. A `WebPlugin` is a
 * plain object contributed by a sibling package (an in-tree plugin under
 * `apps/web/src/plugins/<name>/`) and collected in `plugins/index.ts`. The
 * host iterates the registry to compose routes, nav items, and API client
 * namespaces — no runtime DI, no dynamic imports.
 *
 * Named `WebPlugin` (not `Plugin`) to disambiguate from the BE `PluginEntry`,
 * which is a NestJS module class — same intent, structurally different.
 *
 * @module plugins
 * @see apps/api/src/plugins.ts — BE counterpart that this design mirrors
 */
import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';

import type { ApiRequest, PluginApiNamespaces } from '../app/api/api-client';
import type { Connection } from '../features/connections';
import type { CreateOfferRequest } from '../features/listings';

/**
 * One nav-link contribution from a plugin. `groupLabel` is an open string:
 * a contribution whose label matches an existing nav group is appended to
 * that group; an unknown label creates a new group at the end of the sidebar.
 *
 * Soft contract: contributors should prefer matching one of the existing
 * groups ("Operations", "Diagnostics", "Platform"). Tightening to a closed
 * union is a follow-up if group sprawl becomes a problem.
 *
 * Note: `countKey` is intentionally omitted — count badges are wired to
 * internal queries via a closed key set (`NavCountKey`), not a plugin
 * concern in MVP.
 */
export interface NavContribution {
  groupLabel: string;
  to: string;
  label: string;
  end?: boolean;
}

/**
 * Factory called once at `createApiClient` composition time. Receives the
 * core `request` function (already wrapped with auth + error normalisation)
 * and returns the namespaces this plugin wants to expose on `ApiClient`.
 *
 * Plugins extend `PluginApiNamespaces` via TS declaration merging:
 *
 * ```ts
 * declare module '../../app/api/api-client' {
 *   interface PluginApiNamespaces {
 *     allegro: AllegroApi;
 *   }
 * }
 * ```
 */
export type PluginApiNamespacesFactory = (
  request: ApiRequest,
) => Partial<PluginApiNamespaces>;

/**
 * Props every per-platform offer-creation wizard receives. The launcher
 * (`features/listings/components/OfferCreationLauncher.tsx`) resolves the
 * connection up front and owns the surrounding Dialog chrome — so each
 * contributed wizard is **content-only**, knows its platform via
 * `connection.platformType`, and never renders its own Dialog or
 * connection picker (#608).
 *
 * `defaultVariantId` / `initialValues` carry retry-path hints.
 */
export interface OfferCreationWizardProps {
  connection: Connection;
  defaultVariantId?: string;
  initialValues?: CreateOfferRequest;
  /** Fired by the wizard's Cancel/Close affordance — the launcher uses
   *  this to close the surrounding Dialog. */
  onCancel: () => void;
  onSubmitted: (offerCreationRecordId: string, connectionId: string) => void;
}

/**
 * Plugin contribution for capability-shaped offer creation (#608).
 *
 * `component` is a pre-bound React component, not a render fn — keeps the
 * contribution a pure value at module load, plays nicely with test mocks,
 * and matches how React expects to consume components at JSX time
 * (`<contribution.component {...props} />`).
 */
export interface OfferCreationWizardContribution {
  /** Connection `platformType` this wizard handles, e.g. 'allegro'. */
  platformType: string;
  component: ComponentType<OfferCreationWizardProps>;
}

/**
 * A build-time plugin contributing routes, nav items, API namespaces,
 * and/or an offer-creation wizard.
 * Authored via `definePlugin({...})` for type-checked ergonomics; collected
 * in `apps/web/src/plugins/index.ts`.
 */
export interface WebPlugin {
  /** Stable id, kebab-case. Must be unique across the registry. */
  id: string;
  /** React Router route objects appended to the root route's children. */
  routes?: RouteObject[];
  /** Sidebar nav items merged into the existing nav groups by label. */
  navItems?: NavContribution[];
  /** Factory that produces typed API client namespaces. */
  apiNamespaces?: PluginApiNamespacesFactory;
  /** Per-platform offer-creation wizard registered against the
   *  `OfferCreationLauncher` dispatch site (#608). */
  offerCreationWizard?: OfferCreationWizardContribution;
}
