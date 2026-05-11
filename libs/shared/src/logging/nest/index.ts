/**
 * Logging / NestJS Subpath Exports
 *
 * Host-only entry point that ships the NestJS-backed `LoggerPort` adapter
 * and its `installNestLogger()` installer. Application bootstrap files
 * (`apps/api`, `apps/worker`) import from here; library code and plugins
 * import only from `@openlinker/shared/logging`.
 *
 * @module libs/shared/src/logging/nest
 */
export { NestLoggerAdapter } from './nest-logger.adapter';
export { installNestLogger } from './install';
