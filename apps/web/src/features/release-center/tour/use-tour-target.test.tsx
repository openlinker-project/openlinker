/**
 * useTourTarget (#4154)
 *
 * The router navigates after a step changes, so the first match can be the
 * previous screen's node. The hook must drop it once it is detached and pick
 * up the next screen's element, instead of leaving a ring on nothing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTourTarget } from './use-tour-target';

function wrapper({ children }: PropsWithChildren): ReactElement {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mount(label: string): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-tour', 'label-master');
  element.textContent = label;
  document.body.appendChild(element);
  return element;
}

describe('useTourTarget', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('should report the element when it is already on the page', async () => {
    const element = mount('first');
    const { result } = renderHook(() => useTourTarget('label-master', true, 0), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ state: 'found', element }));
  });

  it('should find the next screen element when the first match is detached', async () => {
    const stale = mount('stale');
    const { result } = renderHook(() => useTourTarget('label-master', true, 0), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('found'));

    let fresh: HTMLElement | undefined;
    act(() => {
      stale.remove();
      fresh = mount('fresh');
    });

    await waitFor(() => expect(result.current).toEqual({ state: 'found', element: fresh }));
  });

  it('should go back to waiting when the matched element disappears for good', async () => {
    const stale = mount('stale');
    const { result } = renderHook(() => useTourTarget('label-master', true, 0), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('found'));

    act(() => {
      stale.remove();
    });

    await waitFor(() => expect(result.current.state).toBe('waiting'));
  });
});
