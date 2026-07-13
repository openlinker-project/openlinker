/**
 * Erli Allegro-Credentials-Reuse Rewriter (#1387, ADR-031)
 *
 * Implements `ConnectionCredentialsRewriterPort` for the Erli adapter key.
 * Resolves the `reuseAllegroConnectionId` shape into a concrete
 * `allegroClientId`/`allegroClientSecret` pair, server-side, so the raw
 * Allegro `clientSecret` is never serialized into an HTTP response body.
 * Registered against `ConnectionCredentialsRewriterRegistryService` at
 * `erli.shopapi.v1` from `ErliCredentialsRewriterModule` (not from
 * `erli-plugin.ts#register(host)`) because it needs `ConnectionPort` — a
 * NestJS-injected dependency deliberately kept out of the framework-neutral
 * `HostServices` bag — mirroring `ErliWebhookProvisioningAdapter`'s wiring.
 *
 * "Belongs to the operator's own tenant" (per the issue's acceptance
 * criteria) has no dedicated model in this codebase today — there is no
 * `tenantId`/`organizationId` anywhere on `Connection` or `AuthenticatedUser`;
 * `@Roles('admin')` on the credentials-rotation endpoint is the only access
 * boundary that exists, and it already applies uniformly to every connection
 * in the single OpenLinker deployment. The closest enforceable "ownership"
 * check available is that the source id resolves to a real, existing
 * connection of `platformType: 'allegro'` in this same instance — anything
 * else (a missing id, or an id for a non-Allegro connection) is rejected
 * below.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link ConnectionCredentialsRewriterPort}
 */
import {
  type ConnectionCredentialsRewriterPort,
  ConnectionCredentialsRewriteException,
  type CredentialsResolverPort,
} from '@openlinker/core/integrations';
import {
  type Connection,
  type ConnectionPort,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

interface AllegroAppCredentials {
  clientId?: string;
  clientSecret?: string;
}

export class ErliAllegroCredentialsRewriterAdapter implements ConnectionCredentialsRewriterPort {
  private readonly logger = new Logger(ErliAllegroCredentialsRewriterAdapter.name);

  constructor(
    private readonly connectionPort: ConnectionPort,
    private readonly credentialsResolver: CredentialsResolverPort,
    private readonly pluginName: string = 'Erli'
  ) {}

  async rewrite(credentials: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { reuseAllegroConnectionId, ...rest } = credentials;
    if (reuseAllegroConnectionId === undefined) {
      return credentials;
    }
    if (typeof reuseAllegroConnectionId !== 'string' || reuseAllegroConnectionId.trim() === '') {
      throw new ConnectionCredentialsRewriteException(
        this.pluginName,
        '`reuseAllegroConnectionId` must be a non-empty string'
      );
    }

    let sourceConnection: Connection;
    try {
      sourceConnection = await this.connectionPort.get(reuseAllegroConnectionId);
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        throw new ConnectionCredentialsRewriteException(
          this.pluginName,
          `connection ${reuseAllegroConnectionId} does not exist`
        );
      }
      throw error;
    }
    if (sourceConnection.platformType !== 'allegro') {
      throw new ConnectionCredentialsRewriteException(
        this.pluginName,
        `connection ${reuseAllegroConnectionId} is not an Allegro connection ` +
          `(platformType: ${sourceConnection.platformType}); cannot reuse its credentials`
      );
    }
    if (sourceConnection.status !== 'active') {
      throw new ConnectionCredentialsRewriteException(
        this.pluginName,
        `Allegro connection ${reuseAllegroConnectionId} is not active ` +
          `(status: ${sourceConnection.status}); cannot reuse its credentials`
      );
    }

    const sourceCredentials = await this.credentialsResolver.get<AllegroAppCredentials>(
      sourceConnection.credentialsRef
    );
    if (!sourceCredentials.clientId || !sourceCredentials.clientSecret) {
      throw new ConnectionCredentialsRewriteException(
        this.pluginName,
        `Allegro connection ${reuseAllegroConnectionId} does not have app client credentials ` +
          '(clientId/clientSecret) configured to reuse'
      );
    }

    this.logger.log(
      `Reusing Allegro app credentials from connection ${reuseAllegroConnectionId} for credential update`
    );
    return {
      ...rest,
      allegroClientId: sourceCredentials.clientId,
      allegroClientSecret: sourceCredentials.clientSecret,
    };
  }
}
