/**
 * Two-stage paginated total - mechanism tests (#2945)
 *
 * Each of the four properties this hook exists to guarantee gets a test that
 * fails if the guarantee is removed. They are the four ways this change turns
 * into a regression, so none of them may be asserted only by reading the code.
 */
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inferTotalFromLoadedPage,
  inferTotalFromPage,
  usePaginatedTotal,
  TOTAL_DEBOUNCE_MS,
  TOTAL_LOADER_DELAY_MS,
} from './use-paginated-total';

function createWrapper(): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/**
 * Advance fake timers inside `act` so React flushes the state they cause.
 *
 * `advanceTimersByTimeAsync` flushes pending microtasks between timers, which
 * is what lets a resolved query settle without `waitFor`. `waitFor` is
 * deliberately NOT used anywhere in this file: it polls in REAL time, so with
 * fake timers it either never observes the change or (with
 * `shouldAdvanceTime`) burns fake milliseconds and trips the very loader delay
 * these tests measure.
 */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * These fakes resolve a plain number, so identity is the honest selector. A
 * real caller's `/count` answers with `{ total }` and selects that field.
 */
const selectTotal = (n: number): number => n;

/** Let pending promises settle without moving the clock. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('inferTotalFromPage', () => {
  it('reports the exact total for a short page - the count is then never needed', () => {
    expect(inferTotalFromPage({ rowCount: 12, limit: 20, offset: 0 })).toBe(12);
    expect(inferTotalFromPage({ rowCount: 7, limit: 20, offset: 40 })).toBe(47);
  });

  it('reports an empty FIRST page as a genuine zero', () => {
    expect(inferTotalFromPage({ rowCount: 0, limit: 20, offset: 0 })).toBe(0);
  });

  it('refuses to infer from a FULL page, where more rows may follow', () => {
    expect(inferTotalFromPage({ rowCount: 20, limit: 20, offset: 0 })).toBeNull();
    expect(inferTotalFromPage({ rowCount: 20, limit: 20, offset: 100 })).toBeNull();
  });

  it('refuses to infer from a non-finite page rather than producing NaN', () => {
    // `offset + rowCount` on an absent field is `NaN`, which passes every
    // `!== null` guard downstream and renders as the literal "of NaN" while
    // killing Next (every comparison against NaN is false). A worse stand-in
    // than the `0` this mechanism already refuses.
    expect(
      inferTotalFromPage({ rowCount: 1, limit: undefined as unknown as number, offset: 0 })
    ).toBeNull();
    expect(
      inferTotalFromPage({ rowCount: 1, limit: 20, offset: undefined as unknown as number })
    ).toBeNull();
    expect(inferTotalFromPage({ rowCount: NaN, limit: 20, offset: 0 })).toBeNull();
  });

  it('refuses to infer from an empty page past the start, where the offset overshot', () => {
    // The operator paged beyond the end: the total is anywhere from 0 to 40,
    // and `offset + 0` would state 40 as a fact.
    expect(inferTotalFromPage({ rowCount: 0, limit: 20, offset: 40 })).toBeNull();
  });
});

describe('usePaginatedTotal (#2945)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch at all when the page already implies an exact total', async () => {
    const queryFn = vi.fn();
    const { result } = renderHook(
      () =>
        usePaginatedTotal({
          queryKey: ['orders', 'count', {}],
          queryFn,
          selectTotal,
          knownTotal: 12,
        }),
      { wrapper: createWrapper() }
    );

    await advance(TOTAL_DEBOUNCE_MS + TOTAL_LOADER_DELAY_MS + 50);

    // The whole "make the change invisible on a small install" property: the
    // count is not requested, so there is nothing for the loader to delay.
    expect(queryFn).not.toHaveBeenCalled();
    expect(result.current.total).toBe(12);
    expect(result.current.state).toBe('known');
    expect(result.current.showLoader).toBe(false);
  });

  it('debounces the filter key so a keystroke burst issues ONE count', async () => {
    const queryFn = vi.fn().mockResolvedValue(9000);
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) =>
        usePaginatedTotal({ queryKey: ['orders', 'count', { search }], queryFn, selectTotal }),
      { wrapper: createWrapper(), initialProps: { search: '' } }
    );

    // The FIRST mount is not debounced - there is nothing to settle, and making
    // the operator wait 400 ms for the initial count would be worse than the
    // problem. So one call is expected before any keystroke.
    await flush();
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Six keystrokes well inside the debounce window.
    for (const search of ['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef']) {
      rerender({ search });
      await advance(30);
    }
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('settling');

    // The loader is armed by `pending` ALONE, never by `settling`. Six
    // keystrokes have burned 180 ms of the window and this waits out the rest,
    // so a timer armed on the debounce would have fired by now and a small
    // install would flash a loader on every burst - the flicker the delay
    // exists to prevent, introduced by the delay. That bug shipped in the first
    // draft and was fixed with no test behind it (#2957 review, I4); this is
    // the test. Break it by arming `useDelayedFlag` on `settling || pending`.
    await advance(TOTAL_LOADER_DELAY_MS + 20);
    expect(result.current.state).toBe('settling');
    expect(result.current.showLoader).toBe(false);

    // Without the debounce this would be seven calls, one per keystroke,
    // against the most expensive query in the system.
    await advance(TOTAL_DEBOUNCE_MS + 10);
    await flush();
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('never renders a superseded total when a slow answer lands after a fast one', async () => {
    const resolvers: Record<string, (value: number) => void> = {};
    const queryFn = vi.fn().mockImplementation(() => {
      const key = currentSearch;
      return new Promise<number>((resolve) => {
        resolvers[key] = resolve;
      });
    });

    let currentSearch = 'slow';
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) => {
        currentSearch = search;
        return usePaginatedTotal({
          queryKey: ['orders', 'count', { search }],
          queryFn,
          selectTotal,
        });
      },
      { wrapper: createWrapper(), initialProps: { search: 'slow' } }
    );

    // The first filter's count goes in flight on mount (nothing to settle).
    await flush();
    expect(queryFn).toHaveBeenCalledTimes(1);

    // The operator moves to a second filter, which settles and answers fast.
    rerender({ search: 'fast' });
    await advance(TOTAL_DEBOUNCE_MS + 10);
    await flush();
    expect(queryFn).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvers.fast(42);
      await Promise.resolve();
    });
    await flush();
    expect(result.current.total).toBe(42);

    // Now the ABANDONED filter's request finally answers. It must not be
    // rendered: it describes a filter the operator has left, and a wrong total
    // that looks authoritative is worse than a missing one.
    await act(async () => {
      resolvers.slow(999999);
      await Promise.resolve();
    });
    await advance(50);

    expect(result.current.total).toBe(42);
  });

  it('aborts the superseded request when the filter moves on', async () => {
    const signals: AbortSignal[] = [];
    const queryFn = vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise<number>(() => undefined);
    });
    const { rerender } = renderHook(
      ({ search }: { search: string }) =>
        usePaginatedTotal({ queryKey: ['orders', 'count', { search }], queryFn, selectTotal }),
      { wrapper: createWrapper(), initialProps: { search: 'first' } }
    );

    await flush();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    // The operator moves on. The in-flight count is now work nobody will read,
    // against the most expensive query in the system - it must be cancelled,
    // not merely ignored.
    rerender({ search: 'second' });
    await advance(TOTAL_DEBOUNCE_MS + 10);
    await flush();

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("reports null - never the previous filter's number - while the debounce settles", async () => {
    const queryFn = vi.fn().mockResolvedValue(500);
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) =>
        usePaginatedTotal({ queryKey: ['orders', 'count', { search }], queryFn, selectTotal }),
      { wrapper: createWrapper(), initialProps: { search: 'first' } }
    );

    await flush();
    expect(result.current.total).toBe(500);

    // The rows have already moved to the new filter. The old total must go.
    rerender({ search: 'second' });
    expect(result.current.total).toBeNull();
    expect(result.current.state).toBe('settling');
  });

  it('does not show the loader when the count resolves inside the delay window', async () => {
    let resolveTotal: ((value: number) => void) | undefined;
    const queryFn = vi.fn().mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveTotal = resolve;
        })
    );
    const { result } = renderHook(
      () => usePaginatedTotal({ queryKey: ['orders', 'count', {}], queryFn, selectTotal }),
      { wrapper: createWrapper() }
    );

    await flush();
    expect(queryFn).toHaveBeenCalledTimes(1);

    // ~11 ms is what a 10k-order count costs. A loader appearing and vanishing
    // inside that window is a flicker, and worse than no state change at all.
    await advance(11);
    expect(result.current.showLoader).toBe(false);

    await act(async () => {
      resolveTotal?.(1234);
      await Promise.resolve();
    });
    await flush();
    expect(result.current.total).toBe(1234);
    await advance(TOTAL_LOADER_DELAY_MS + 50);

    expect(result.current.showLoader).toBe(false);
  });

  it('shows the loader once the count has been in flight past the delay', async () => {
    const queryFn = vi.fn().mockImplementation(() => new Promise<number>(() => undefined));
    const { result } = renderHook(
      () => usePaginatedTotal({ queryKey: ['orders', 'count', {}], queryFn, selectTotal }),
      { wrapper: createWrapper() }
    );

    await flush();
    expect(result.current.state).toBe('pending');
    expect(result.current.showLoader).toBe(false);

    await advance(TOTAL_LOADER_DELAY_MS + 20);
    expect(result.current.showLoader).toBe(true);
  });

  it('leaves the total null on failure - it is never rendered as 0', async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error('count blew up'));
    const { result } = renderHook(
      () => usePaginatedTotal({ queryKey: ['orders', 'count', {}], queryFn, selectTotal }),
      { wrapper: createWrapper() }
    );

    await flush();
    expect(result.current.state).toBe('unavailable');

    // A failed read must not become a positive claim that nothing matched.
    expect(result.current.total).toBeNull();
    expect(result.current.total).not.toBe(0);
  });

  it('reports UNAVAILABLE when selectTotal declines to read a number', async () => {
    // A response the caller cannot honestly read a total out of - `/listings`
    // answering without its lifecycle buckets while a tab is selected. The
    // payload's own number is the WRONG number there, so the honest answer is
    // unknown rather than a substitute from a different question.
    const queryFn = vi.fn().mockResolvedValue(42);
    const { result } = renderHook(
      () =>
        usePaginatedTotal({
          queryKey: ['orders', 'count', {}],
          queryFn,
          selectTotal: () => null,
        }),
      { wrapper: createWrapper() }
    );

    await flush();
    expect(result.current.state).toBe('unavailable');
    expect(result.current.total).toBeNull();
    expect(result.current.total).not.toBe(0);
    // The raw payload is still handed back, so a caller reading more than the
    // number off it is not punished for the total being unreadable.
    expect(result.current.data).toBe(42);
  });

  it('shows a CACHED total for the current key immediately, even while disabled', async () => {
    // The key is always the current filters', so cached data can only ever be
    // this filter's answer - blanking it while `enabled` is false or the
    // debounce settles would be a flicker for nothing. This is the common case
    // when paging, since the key carries no offset.
    const queryFn = vi.fn().mockResolvedValue(4321);
    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePaginatedTotal({
          queryKey: ['orders', 'count', { search: 'x' }],
          queryFn,
          selectTotal,
          enabled,
        }),
      { wrapper, initialProps: { enabled: true } }
    );

    await flush();
    expect(result.current.total).toBe(4321);

    // The rows query goes back in flight, so the caller disables the count.
    rerender({ enabled: false });
    expect(result.current.total).toBe(4321);
    expect(result.current.state).toBe('known');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('does not fetch while disabled', async () => {
    const queryFn = vi.fn().mockResolvedValue(5);
    const { result } = renderHook(
      () =>
        usePaginatedTotal({
          queryKey: ['orders', 'count', {}],
          queryFn,
          selectTotal,
          enabled: false,
        }),
      { wrapper: createWrapper() }
    );

    await advance(TOTAL_DEBOUNCE_MS + TOTAL_LOADER_DELAY_MS + 50);

    expect(queryFn).not.toHaveBeenCalled();
    expect(result.current.total).toBeNull();
    // `idle`, NOT `unavailable`: nothing failed, the caller simply has not
    // asked yet. A surface renders the two differently, so collapsing them
    // would make an ordinary refetch report a failure that did not happen.
    expect(result.current.state).toBe('idle');
  });

  it('infers nothing from a page that has not loaded', () => {
    // `rowCount: 0, offset: 0` is an exact zero for a page that HAS loaded.
    // Before it lands there is no page to infer from, and inferring `0` there
    // would render a confident "0 results" over rows that are on their way.
    expect(inferTotalFromLoadedPage(undefined)).toBeNull();
    expect(inferTotalFromLoadedPage({ items: [], limit: 20, offset: 0 })).toBe(0);
    expect(inferTotalFromLoadedPage({ items: [1, 2, 3], limit: 20, offset: 40 })).toBe(43);
  });

  it('reuses one count across pages, because the key carries no offset', async () => {
    const queryFn = vi.fn().mockResolvedValue(4321);
    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ offset }: { offset: number }) =>
        // The offset is deliberately absent from the key. Paging must not
        // recompute the expensive aggregate.
        usePaginatedTotal({
          queryKey: ['orders', 'count', { search: 'x' }],
          queryFn,
          selectTotal,
          knownTotal: null,
          // referenced so the test reads as page-dependent even though the key is not
          enabled: offset >= 0,
        }),
      { wrapper, initialProps: { offset: 0 } }
    );

    await flush();
    expect(result.current.total).toBe(4321);

    rerender({ offset: 20 });
    rerender({ offset: 40 });
    await advance(TOTAL_DEBOUNCE_MS + 50);

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result.current.total).toBe(4321);
  });
  it('keeps a KNOWN total when a BACKGROUND refetch fails', async () => {
    // Query v5 keeps `state.data` across a failed background refetch and only
    // flips the status to 'error', so reading `isSuccess` discards a good
    // answer for the very same filters (#2957 review round 3, I2). With
    // `refetchOnWindowFocus` on and `retry: false` - this app's defaults - one
    // transient failure after an alt-tab turned "1,234" into
    // "(count unavailable)" while the real number sat in the cache.
    const queryFn = vi.fn().mockResolvedValueOnce(1234).mockRejectedValue(new Error('transient'));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } },
    });
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => usePaginatedTotal({ queryKey: ['orders', 'count', {}], queryFn, selectTotal }),
      { wrapper }
    );

    await flush();
    expect(result.current.total).toBe(1234);
    expect(result.current.state).toBe('known');

    // The refetch fails; the answer in hand is still this key's answer.
    await act(async () => {
      await client.refetchQueries({ queryKey: ['orders', 'count', {}] });
    });

    await flush();
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(result.current.total).toBe(1234);
    expect(result.current.state).toBe('known');
  });
});
