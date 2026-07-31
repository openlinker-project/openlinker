/**
 * Request Priority Interceptor Unit Tests
 *
 * `CallHandler.handle()` fakes here MUST return a `defer(...)` Observable,
 * never eagerly compute their side effect when `handle()` is called — real
 * Nest's `RouterExecutionContext` wraps the actual route-handler invocation
 * in `defer(...)` too (that's the whole reason interceptors can wrap
 * before/after logic around execution). A fake that reads
 * `getCurrentPriority()` synchronously inside `handle()` itself would pass
 * even against a broken interceptor that exits the ALS scope before
 * anything subscribes — `defer` is what makes these tests actually exercise
 * subscribe-time context propagation.
 *
 * @module apps/api/src/http/interceptors
 */
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, of } from 'rxjs';
import { getCurrentPriority, getCurrentRateLimitSignal } from '@openlinker/shared/rate-limit';
import { RequestPriorityInterceptor } from './request-priority.interceptor';

function makeContext(request: { on?: jest.Mock }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('RequestPriorityInterceptor', () => {
  it("classifies the handler's call tree as 'interactive' (subscribe-time, not construction-time)", (done) => {
    const interceptor = new RequestPriorityInterceptor();
    const request = { on: jest.fn() };
    let observedPriority: string | undefined;

    const next: CallHandler = {
      // Lazy — mirrors Nest's real `defer(() => routeHandler(...))`. Reading
      // getCurrentPriority() here (not at handle()-call time) is what would
      // have failed against the pre-fix implementation, which exited the
      // ALS scope before this factory ever ran.
      handle: () =>
        defer(() => {
          observedPriority = getCurrentPriority();
          return of('ok');
        }),
    };

    interceptor.intercept(makeContext(request), next).subscribe(() => {
      expect(observedPriority).toBe('interactive');
      done();
    });
  });

  it("bridges the request's close event to the signal carried in the context", (done) => {
    const interceptor = new RequestPriorityInterceptor();
    let closeListener: (() => void) | undefined;
    const request = {
      on: jest.fn((event: string, listener: () => void) => {
        if (event === 'close') closeListener = listener;
      }),
    };

    let observedSignal: AbortSignal | undefined;
    const next: CallHandler = {
      handle: () =>
        defer(() => {
          observedSignal = getCurrentRateLimitSignal();
          return of('ok');
        }),
    };

    interceptor.intercept(makeContext(request), next).subscribe(() => {
      expect(observedSignal).toBeDefined();
      expect(observedSignal?.aborted).toBe(false);
      closeListener?.();
      expect(observedSignal?.aborted).toBe(true);
      done();
    });
  });

  it('does not throw when the request has no on() method (non-HTTP transport)', (done) => {
    const interceptor = new RequestPriorityInterceptor();
    const next: CallHandler = { handle: () => defer(() => of('ok')) };

    interceptor.intercept(makeContext({}), next).subscribe((value) => {
      expect(value).toBe('ok');
      done();
    });
  });

  it('restores background priority once the interceptor call tree completes', () => {
    const interceptor = new RequestPriorityInterceptor();
    const request = { on: jest.fn() };
    const next: CallHandler = { handle: () => defer(() => of('ok')) };

    interceptor.intercept(makeContext(request), next);

    expect(getCurrentPriority()).toBe('background');
  });

  it('does NOT classify as interactive if the handler is never subscribed (constructing the Observable is not enough)', () => {
    const interceptor = new RequestPriorityInterceptor();
    const request = { on: jest.fn() };
    let handleWasCalled = false;
    const next: CallHandler = {
      handle: () => {
        handleWasCalled = true;
        return defer(() => of('ok'));
      },
    };

    interceptor.intercept(makeContext(request), next);

    // Constructing the outer Observable must not eagerly invoke next.handle()
    // — that only happens once something subscribes, exactly like real Nest.
    expect(handleWasCalled).toBe(false);
  });
});
