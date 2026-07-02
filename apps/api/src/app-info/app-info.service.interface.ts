/**
 * App Info Service Interface
 *
 * Contract for resolving the running process's product + API version, used by
 * the runtime version surface (`GET /v1/health`) and the Swagger document.
 *
 * @module apps/api/src/app-info
 */
import type { AppInfo } from './app-info.types';

export interface IAppInfoService {
  /** Product (release) version, resolved from env with a dev fallback. */
  getProductVersion(): string;
  /** HTTP API version label (e.g. `v1`). */
  getApiVersion(): string;
  /** Combined identity for the version surface. */
  getAppInfo(): AppInfo;
}
