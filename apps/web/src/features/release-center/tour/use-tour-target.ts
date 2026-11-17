/**
 * Waits for a `data-tour` element (#4149)
 *
 * After navigating, the target may not exist yet: the route chunk is lazy and
 * its data still loading. A MutationObserver reports it the moment it appears;
 * the timeout is extended while queries are still in flight, so a slow screen
 * is not reported as a missing element.
 *
 * @module features/release-center/tour
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const BASE_TIMEOUT_MS = 1500;
const MAX_EXTENSIONS = 4;

export function findTourTarget(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target.replace(/"/g, '')}"]`);
}

export type TargetResult = { state: 'waiting' | 'missing' } | { state: 'found'; element: HTMLElement };

export function useTourTarget(target: string | null, enabled: boolean): TargetResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<TargetResult>({ state: 'waiting' });

  useEffect(() => {
    setResult({ state: 'waiting' });
    if (!enabled || !target) return undefined;

    let settled = false;
    let extensions = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => check());

    const finish = (next: TargetResult): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (timer) clearTimeout(timer);
      setResult(next);
    };
    function check(): void {
      const element = findTourTarget(target as string);
      if (element) finish({ state: 'found', element });
    }
    const arm = (): void => {
      timer = setTimeout(() => {
        if (settled) return;
        if (queryClient.isFetching() > 0 && extensions < MAX_EXTENSIONS) {
          extensions += 1;
          arm();
          return;
        }
        finish({ state: 'missing' });
      }, BASE_TIMEOUT_MS);
    };

    check();
    if (!settled) {
      observer.observe(document.body, { childList: true, subtree: true });
      arm();
    }
    return () => {
      settled = true;
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [target, enabled, queryClient]);

  return result;
}
