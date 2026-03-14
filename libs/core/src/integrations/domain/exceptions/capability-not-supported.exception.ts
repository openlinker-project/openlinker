/**
 * Capability Not Supported Exception
 *
 * Domain exception thrown when an adapter does not support a requested capability.
 * This error is thrown by the integrations service when attempting to use an
 * adapter for a capability it doesn't support.
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
import { Capability } from '../types/adapter.types';

export class CapabilityNotSupportedException extends Error {
  constructor(adapterKey: string, capability: Capability) {
    super(`Adapter ${adapterKey} does not support capability: ${capability}`);
    this.name = 'CapabilityNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}







