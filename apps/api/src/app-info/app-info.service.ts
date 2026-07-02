/**
 * App Info Service
 *
 * Resolves the running process's product version from a single, deploy-friendly
 * chain: `OL_PRODUCT_VERSION` (set by the deploy to the release tag) →
 * `npm_package_version` (present under a `pnpm`-run dev process) → `0.0.0-dev`
 * fallback. The API version is a compile-time constant (`API_VERSION_LABEL`)
 * shared with the URI-versioning config so the routed prefix and the reported
 * `api` value stay in lockstep. See ADR-029 (Axis 3).
 *
 * @module apps/api/src/app-info
 * @implements {IAppInfoService}
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IAppInfoService } from './app-info.service.interface';
import { API_VERSION_LABEL, type AppInfo } from './app-info.types';

const DEV_VERSION_FALLBACK = '0.0.0-dev';

@Injectable()
export class AppInfoService implements IAppInfoService {
  constructor(private readonly configService: ConfigService) {}

  getProductVersion(): string {
    const explicit = this.configService.get<string>('OL_PRODUCT_VERSION');
    if (explicit && explicit.trim().length > 0) {
      return explicit.trim();
    }
    const npmVersion = process.env.npm_package_version;
    if (npmVersion && npmVersion.trim().length > 0) {
      return npmVersion.trim();
    }
    return DEV_VERSION_FALLBACK;
  }

  getApiVersion(): string {
    return API_VERSION_LABEL;
  }

  getAppInfo(): AppInfo {
    return {
      version: this.getProductVersion(),
      api: this.getApiVersion(),
    };
  }
}
