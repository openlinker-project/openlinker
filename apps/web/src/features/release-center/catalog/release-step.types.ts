/**
 * Release step catalog types (#4145, ADR-085)
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
  /** Delivery methods of this channel that carry a carrier name and still go through the shop. */
  unassignedCarrierMethods: number;
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
  /** Written by hand: the minor that ships the step. */
  introducedIn: string;
  /** Computed from data, never hard-coded per step. */
  importance: (ctx: ReleaseStepContext) => ReleaseStepImportance;
  /** Permission that can perform the step; a UX marker, the API still decides. */
  requires: string;
  /** Router path with `:params`, checked against the router by the catalog check. */
  routePattern: string;
  routeParams: (ctx: ReleaseStepContext) => Readonly<Record<string, string>>;
  /** Value of the `data-tour` attribute the guided tour highlights. */
  target: string;
  appliesWhen: (ctx: ReleaseStepContext) => boolean;
  completeOn: ReleaseStepCompletion;
}
