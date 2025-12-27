/**
 * Adapter Not Found Exception
 *
 * Domain exception thrown when an adapter with the specified adapter key
 * does not exist in the registry. This error is thrown by the adapter registry
 * when attempting to resolve an unknown adapter.
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
export class AdapterNotFoundException extends Error {
  constructor(adapterKey: string) {
    super(`Adapter not found: ${adapterKey}`);
    this.name = 'AdapterNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}

