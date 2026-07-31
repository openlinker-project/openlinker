/**
 * Request Priority Interceptor
 *
 * Global `APP_INTERCEPTOR` counterpart to `SyncJobRunner.processJob`'s
 * `runWithPriority` entry point (#1810) — every interactive HTTP request
 * classifies its own outbound calls (through `HostServices.http`) as
 * `'interactive'`, so they are preferred over queued `'background'` worker
 * traffic on a shared connection's rate limiter. The signal is bridged from
 * the request's own `close` event, so a client disconnect cancels a queued
 * rate-limit wait rather than leaving it to time out.
 *
 * @module apps/api/src/http/interceptors
 */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { runWithPriority } from '@openlinker/shared/rate-limit';

interface RequestWithCloseEvent {
  on?: (event: 'close', listener: () => void) => void;
}

@Injectable()
export class RequestPriorityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithCloseEvent>();
    const controller = new AbortController();
    if (typeof request?.on === 'function') {
      request.on('close', () => controller.abort());
    }

    return runWithPriority({ priority: 'interactive', signal: controller.signal }, () =>
      next.handle()
    );
  }
}
