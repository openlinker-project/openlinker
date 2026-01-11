/**
 * Customer Identity Resolver Port
 *
 * Defines the contract for customer identity resolution operations. This port
 * interface specifies how customer identity is resolved from external buyer data,
 * supporting both external-only and email-fallback modes.
 *
 * Implemented by CustomerIdentityResolverService to provide identity resolution
 * capabilities across all adapters.
 *
 * @module libs/core/src/customers/domain/ports
 * @see {@link CustomerIdentityResolverService} for the implementation
 */
import {
  CustomerIdentityResolutionRequest,
  CustomerIdentityResolutionResult,
} from '../types/customer-identity.types';

export interface CustomerIdentityResolverPort {
  /**
   * Resolve customer identity from external buyer data
   *
   * Resolves internal customer ID using:
   * 1. Primary: External buyer ID mapping (sourceConnectionId scoped)
   * 2. Fallback (if enabled): Email hash lookup to link across origins
   *
   * @param request - Customer identity resolution request
   * @returns Customer identity resolution result
   */
  resolveCustomerIdentity(
    request: CustomerIdentityResolutionRequest,
  ): Promise<CustomerIdentityResolutionResult>;
}
