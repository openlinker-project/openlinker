/**
 * NestJS Logger Installer
 *
 * One-liner host helper that swaps the active `LoggerPort` backend to the
 * NestJS-backed adapter. Call as the first statement of an app's
 * `bootstrap()` so every subsequent `new Logger(ctx).log(...)` call emits
 * via Nest's logger formatter.
 *
 * @module libs/shared/src/logging/nest
 */
import { setLoggerBackend } from '../logger';

import { NestLoggerAdapter } from './nest-logger.adapter';

export function installNestLogger(): void {
  setLoggerBackend(new NestLoggerAdapter());
}
