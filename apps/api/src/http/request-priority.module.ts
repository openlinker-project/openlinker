/**
 * Request Priority Module
 *
 * Registers `RequestPriorityInterceptor` as a global `APP_INTERCEPTOR`
 * (#1810) — mirrors `AuthModule`'s `APP_GUARD` registration pattern.
 *
 * @module apps/api/src/http
 */
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RequestPriorityInterceptor } from './interceptors/request-priority.interceptor';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: RequestPriorityInterceptor }],
})
export class RequestPriorityModule {}
