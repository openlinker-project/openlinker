/**
 * Release step catalog types (#4145, ADR-086)
 *
 * A step is one setup decision a release asks an operator to make. The catalog
 * holds only data and predicates; every sentence lives in
 * `locales/{en,pl}/release-center.json` under `steps.<id>.*`, so no literal
 * text appears in code.
 *
 * @module features/release-center
 */

export type ReleaseStepScope = 'connection' | 'installation';
export type ReleaseStepImportance = 'required' | 'optional';

/** What a step may be computed from. Plain data so the catalog stays pure. */
export interface ReleaseStepConnection {
  id: string;
  platformType: string;
  capabilities: readonly string[];
  config: Readonly<Record<string, unknown>>;
}

export interface ReleaseStepContext {
  /** Set when the step is evaluated for one connection (scope `connection`). */
  connection: ReleaseStepConnection | null;
  /** Delivery methods of this channel that carry a carrier name and still go through the shop; null when not known (no cheap read exists, so every caller passes null today). */
  unassignedCarrierMethods: number | null;
}

export interface ReleaseStepCompletion {
  /** TanStack Query mutation key the release center observes. */
  mutationKey: readonly string[];
  /** True when this successful mutation did what the step asks. */
  when: (variables: unknown, before: unknown) => boolean;
}

export interface ReleaseStepEntry {
  /** Stable, kebab-case; never derived from an account name. */
  id: string;
  scope: ReleaseStepScope;
  /**
   * Written by hand: the minor that ships the step. Leave it out for a standalone step that belongs to no
   * release (for example a recommended first setup): it appears under "Recommended steps" in the bell
   * and under "General" in the tour, and is never offered by the update dialog.
   */
  introducedIn?: string;
  /** Computed from data, never hard-coded per step. */
  importance: (ctx: ReleaseStepContext) => ReleaseStepImportance;
  /** Permission that can perform the step; a UX marker, the API still decides. */
  requires: string;
  /** Router path with `:params`, checked against the router by the catalog check. */
  routePattern: string;
  routeParams: (ctx: ReleaseStepContext) => Readonly<Record<string, string>>;
  /** Value of the `data-tour` attribute the guided tour highlights. */
  target: string;
  /** False when the step's page cannot be opened without the right to change settings: the view tour leaves it out. Default true. */
  viewable?: boolean;
  /**
   * Where the step sends the operator next (a link inside `target`). The tour stays open on that page and
   * walks `targets` there one by one, reading `steps.<id>.follow<i>` (follow0, follow1, ...) instead of `tourBody`.
   */
  follow?: { routePattern: string; targets: readonly string[] };
  appliesWhen: (ctx: ReleaseStepContext) => boolean;
  completeOn: ReleaseStepCompletion;
}

/** One place a showcase points at: a screen and the element on it. */
export interface ReleaseShowcaseStop {
  routePattern: string;
  /** Value of the `data-tour` attribute the guided tour highlights. */
  target: string;
  /**
   * The screen that opens when the operator does what this stop asks (a row click): any path under
   * `pathPrefix`. The tour stays open there, highlights `target` and reads the stop's `followBody`.
   */
  follow?: { pathPrefix: string; target: string };
}

/**
 * A tour-only item (no setting to change): 1 to 3 ordered stops across screens.
 * It has no importance, scope or completion rule by construction, so it can
 * never count as setup work. Its copy lives under `showcases.<id>` in the locale.
 */
export interface ReleaseShowcaseEntry {
  id: string;
  /**
   * The release that ships it. Leave it out for a standalone tour (for example one offered to a new
   * installation): it then belongs to no release, appears in no notification, and is started by id with
   * `requestReleaseTour({ showcaseId })` from whatever surface decides it is time.
   */
  introducedIn?: string;
  appliesWhen: () => boolean;
  stops: readonly ReleaseShowcaseStop[];
}
