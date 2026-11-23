/**
 * Which steps a successful mutation completes (#4146, ADR-086)
 *
 * Pure so it can be tested without a QueryClient. A step completes only when
 * its own predicate says the save did what the step asks, evaluated against the
 * value BEFORE the save: the connection form sends the whole merged config, so
 * "the key exists" is true for every unrelated save of a connection that
 * already has it. The item key carries the connection id, so saving account A
 * never completes account B.
 *
 * @module features/release-center
 */
import type { ReleaseStepContext, ReleaseStepEntry } from '../catalog/release-step.types';
import { visibleSteps } from './visible-steps';
import { releaseStepItemKey } from './release-state-merge';

export interface ObservedMutation {
  mutationKey: readonly unknown[];
  variables: unknown;
  meta: Readonly<Record<string, unknown>> | undefined;
  /** Connection as it was before the save, when known. */
  before: ReleaseStepContext['connection'] | undefined;
}

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

export function connectionIdOf(
  variables: unknown,
  meta: Readonly<Record<string, unknown>> | undefined
): string | null {
  if (typeof meta?.connectionId === 'string') return meta.connectionId;
  if (typeof variables === 'object' && variables !== null) {
    const id = (variables as { connectionId?: unknown }).connectionId;
    if (typeof id === 'string') return id;
  }
  return null;
}

/** Item keys to mark done (`auto`). Empty when nothing applies. */
export function completedStepItemKeys(
  observed: ObservedMutation,
  steps: readonly ReleaseStepEntry[],
  appVersion: string
): string[] {
  const connectionId = connectionIdOf(observed.variables, observed.meta);
  const keys: string[] = [];
  for (const step of visibleSteps(steps, appVersion)) {
    if (!sameKey(step.completeOn.mutationKey, observed.mutationKey)) continue;
    if (step.scope === 'connection' && !connectionId) continue;
    const ctx: ReleaseStepContext = {
      connection: step.scope === 'connection' ? (observed.before ?? null) : null,
      unassignedCarrierMethods: null,
    };
    if (step.scope === 'connection' && ctx.connection === null) continue;
    if (!step.appliesWhen(ctx)) continue;
    if (!step.completeOn.when(observed.variables, observed.before)) continue;
    keys.push(releaseStepItemKey(step.id, step.scope === 'connection' ? connectionId : null));
  }
  return keys;
}
