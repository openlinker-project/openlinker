/**
 * Request Priority Interceptor Unit Tests
 *
 * @module apps/api/src/http/interceptors
 */
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
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
  it("classifies the handler's call tree as 'interactive'", (done) => {
    const interceptor = new RequestPriorityInterceptor();
    const request = { on: jest.fn() };
    let observedPriority: string | undefined;

    const next: CallHandler = {
      handle: () => {
        observedPriority = getCurrentPriority();
        return of('ok');
      },
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
      handle: () => {
        observedSignal = getCurrentRateLimitSignal();
        return of('ok');
      },
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
    const next: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(makeContext({}), next).subscribe((value) => {
      expect(value).toBe('ok');
      done();
    });
  });

  it('restores background priority once the interceptor call tree completes', () => {
    const interceptor = new RequestPriorityInterceptor();
    const request = { on: jest.fn() };
    const next: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(makeContext(request), next);

    expect(getCurrentPriority()).toBe('background');
  });
});
