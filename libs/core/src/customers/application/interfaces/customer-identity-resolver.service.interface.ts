/**
 * Customer Identity Resolver Service Interface
 *
 * Defines the contract for customer identity resolution operations. This interface
 * specifies the service methods needed by application services, without exposing
 * implementation details.
 *
 * Implemented by CustomerIdentityResolverService in the application layer.
 *
 * @module libs/core/src/customers/application/interfaces
 * @see {@link CustomerIdentityResolverService} for the implementation
 */
import { CustomerIdentityResolverPort } from '../../domain/ports/customer-identity-resolver.port';

export interface ICustomerIdentityResolverService extends CustomerIdentityResolverPort {}
