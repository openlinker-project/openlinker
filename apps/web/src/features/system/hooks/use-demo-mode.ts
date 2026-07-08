/**
 * useDemoMode
 *
 * Thin selector over the system-config query that returns whether the
 * deployment is running in demo mode (`OL_DEMO_MODE=true`). Centralises the
 * `useSystemConfigQuery().data?.demoMode ?? false` derivation so call sites
 * across features don't repeat it. Returns `false` until the config resolves.
 *
 * @module features/system/hooks
 * @see {@link useSystemConfigQuery}
 */
import { useSystemConfigQuery } from './use-system-config-query';

export function useDemoMode(): boolean {
  return useSystemConfigQuery().data?.demoMode ?? false;
}
