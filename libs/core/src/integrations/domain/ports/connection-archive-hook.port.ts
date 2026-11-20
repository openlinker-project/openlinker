/**
 * Connection Archive Hook Port (#3974)
 *
 * Lets a plugin drop the per-connection state it keeps OUTSIDE the
 * connection row when the connection is archived. The host already deletes
 * the stored credential and evicts the connection's HTTP transport; what it
 * cannot see is state a plugin derived from that credential and parked in the
 * shared cache - a minted access token, for example, which stays valid for
 * hours after the credential that minted it is gone.
 *
 * Registered by `adapterKey` in `ConnectionArchiveHookRegistryService`, from
 * the plugin's NestJS module (the webhook-provisioner pattern) - not through
 * `HostServices`, which is deliberately not widened for one consumer.
 *
 * Contract: best effort. `ConnectionService.archive` calls the hook AFTER the
 * row is archived and logs a rejection instead of failing the archive, so an
 * implementation must leave nothing half-done that a retry could not finish.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link ConnectionArchiveHookRegistryService} for the registry
 */
import type { Connection } from '@openlinker/core/identifier-mapping';

export interface ConnectionArchiveHookPort {
  /** Remove plugin-held state for a connection that has just been archived. */
  onArchived(connection: Connection): Promise<void>;
}
