/**
 * Connection Service Types
 *
 * Input/output types for the API-layer ConnectionService. Kept separate from
 * the interface and implementation per engineering-standards.md.
 *
 * @module apps/api/src/integrations/application/interfaces
 */
import type { ConnectionCreate } from '@openlinker/core/identifier-mapping';

/**
 * Connection create input accepted by the API service.
 *
 * Extends the core `ConnectionCreate` with an optional `credentials` payload.
 * When `credentials` is supplied, the service persists it in the integration
 * credentials store and sets `credentialsRef` to the resulting `db:<uuid>`
 * automatically. Exactly one of `credentials` or `credentialsRef` must be set.
 */
export type ConnectionCreateInput = Omit<ConnectionCreate, 'credentialsRef'> & {
  credentialsRef?: string;
  credentials?: Record<string, unknown>;
};
