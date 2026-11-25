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

/** An element that is in the DOM but takes no room (a control that hides itself on this screen) cannot be pointed at. */
function hasRoom(element: HTMLElement): boolean {
  // A DOM without a layout engine (the unit-test environment) reports an empty box for everything.
  if (document.documentElement.getBoundingClientRect().width === 0) return true;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

export type TargetResult = { state: 'waiting' | 'missing' } | { state: 'found'; element: HTMLElement };

export function useTourTarget(
  target: string | null,
  enabled: boolean,
  /** Changes per step: two steps can share a target name while pointing at different screens. */
  stepKey: string | number
): TargetResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<TargetResult>({ state: 'waiting' });

  useEffect(() => {
    setResult({ state: 'waiting' });
    if (!enabled || !target) return undefined;

    let current: HTMLElement | null = null;
    let missing = false;
    let extensions = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const arm = (): void => {
      if (timer) clearTimeout(timer);
      extensions = 0;
      const tick = (): void => {
        if (current || missing) return;
        // Layout may have settled since the last DOM change: look once more before giving up.
        check();
        if (current) return;
        if (queryClient.isFetching() > 0 && extensions < MAX_EXTENSIONS) {
          extensions += 1;
          timer = setTimeout(tick, BASE_TIMEOUT_MS);
          return;
        }
        missing = true;
        setResult({ state: 'missing' });
      };
      timer = setTimeout(tick, BASE_TIMEOUT_MS);
    };

    // The observer outlives the first hit: the router navigates AFTER the step
    // changes, so the first match can be the previous screen's node. When that
    // node is detached, look again instead of keeping a ring on nothing.
    const check = (): void => {
      if (current?.isConnected) return;
      const found = findTourTarget(target);
      const element = found && hasRoom(found) ? found : null;
      if (!element) {
        if (current) {
          current = null;
          missing = false;
          setResult({ state: 'waiting' });
          arm();
        }
        return;
      }
      current = element;
      missing = false;
      if (timer) clearTimeout(timer);
      setResult({ state: 'found', element });
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    if (!current) arm();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [target, enabled, stepKey, queryClient]);

  return result;
}
