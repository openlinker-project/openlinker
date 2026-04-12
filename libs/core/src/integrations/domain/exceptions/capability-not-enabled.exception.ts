/**
 * Capability Not Enabled Exception
 *
 * Thrown when an adapter supports a capability but the operator has not
 * enabled it for this specific connection. Extends CapabilityNotSupportedException
 * so existing `instanceof` callers continue to catch both cases; new callers
 * that want to distinguish "not supported by adapter" from "disabled on this
 * connection" can catch this subtype explicitly.
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
import { Capability } from '../types/adapter.types';
import { CapabilityNotSupportedException } from './capability-not-supported.exception';

export class CapabilityNotEnabledException extends CapabilityNotSupportedException {
  constructor(
    public readonly connectionId: string,
    adapterKey: string,
    capability: Capability,
  ) {
    super(adapterKey, capability);
    this.message = `Connection ${connectionId} has capability ${capability} disabled (adapter ${adapterKey} supports it)`;
    this.name = 'CapabilityNotEnabledException';
    Error.captureStackTrace(this, this.constructor);
  }
}
