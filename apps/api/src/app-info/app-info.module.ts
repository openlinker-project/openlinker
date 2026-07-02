/**
 * App Info Module
 *
 * Exposes the `AppInfoService` (product + API version resolution) behind a
 * Symbol token for injection into the root controller's version surface.
 *
 * @module apps/api/src/app-info
 */
import { Module } from '@nestjs/common';
import { AppInfoService } from './app-info.service';

export const APP_INFO_SERVICE_TOKEN = Symbol('IAppInfoService');

@Module({
  providers: [
    AppInfoService,
    {
      provide: APP_INFO_SERVICE_TOKEN,
      useExisting: AppInfoService,
    },
  ],
  exports: [APP_INFO_SERVICE_TOKEN],
})
export class AppInfoModule {}
