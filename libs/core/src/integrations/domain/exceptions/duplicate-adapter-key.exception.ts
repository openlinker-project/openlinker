/**
 * Duplicate Adapter Key Exception
 *
 * Domain exception thrown when two integration modules attempt to register
 * the same `adapterKey` with the registry. Each adapterKey must be unique
 * across the system — a collision is a configuration error, not a runtime
 * condition, so the registry fails loudly at boot rather than silently
 * overwriting. (#570)
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
export class DuplicateAdapterKeyException extends Error {
  constructor(adapterKey: string) {
    super(
      `Adapter ${adapterKey} already registered. Each adapterKey must be ` +
        `unique across all integration modules.`,
    );
    this.name = 'DuplicateAdapterKeyException';
    Error.captureStackTrace(this, this.constructor);
  }
}
