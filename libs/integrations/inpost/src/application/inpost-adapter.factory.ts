/**
 * InPost Adapter Factory
 *
 * Builds a per-connection `InpostShippingAdapter`: reads + defensively
 * validates the connection config, resolves the ShipX Bearer token via the
 * host `CredentialsResolverPort`, selects the environment base URL, and wires
 * the HTTP client. Invoked from the plugin's `createCapabilityAdapter`. Config
 * *shape* is enforced earlier by the connection-config validator at
 * create/update time; this factory's checks are a runtime safety net that
 * raises `InpostConfigException` on a malformed/under-provisioned connection.
 *
 * @module libs/integrations/inpost/src/application
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { InpostConfigException } from '../domain/exceptions/inpost-config.exception';
import type {
  InpostConnectionConfig,
  InpostEnvironment,
} from '../domain/types/inpost-config.types';
import { InpostEnvironmentValues } from '../domain/types/inpost-config.types';
import type { InpostCredentials } from '../domain/types/inpost-credentials.types';
import { InpostShippingAdapter } from '../infrastructure/adapters/inpost-shipping.adapter';
import { InpostHttpClient } from '../infrastructure/http/inpost-http-client';

const BASE_URLS: Readonly<Record<InpostEnvironment, string>> = {
  sandbox: 'https://sandbox-api-shipx-pl.easypack24.net',
  production: 'https://api-shipx-pl.easypack24.net',
};

export async function createInpostShippingAdapter(
  connection: Connection,
  credentialsResolver: CredentialsResolverPort,
): Promise<InpostShippingAdapter> {
  const config = extractConfig(connection);
  const apiToken = await resolveApiToken(connection, credentialsResolver);
  const client = new InpostHttpClient(BASE_URLS[config.environment], apiToken);
  return new InpostShippingAdapter(client, config);
}

function extractConfig(connection: Connection): InpostConnectionConfig {
  const raw = (connection.config ?? {}) as Record<string, unknown>;

  const environment = raw.environment;
  if (
    typeof environment !== 'string' ||
    !InpostEnvironmentValues.includes(environment as InpostEnvironment)
  ) {
    throw new InpostConfigException(
      `Connection ${connection.id} has invalid or missing InPost environment`,
      connection.id,
    );
  }

  const organizationId = raw.organizationId;
  if (typeof organizationId !== 'string' || organizationId.length === 0) {
    throw new InpostConfigException(
      `Connection ${connection.id} is missing organizationId`,
      connection.id,
    );
  }

  const senderAddress = raw.senderAddress;
  if (typeof senderAddress !== 'object' || senderAddress === null) {
    throw new InpostConfigException(
      `Connection ${connection.id} is missing senderAddress`,
      connection.id,
    );
  }

  return {
    environment: environment as InpostEnvironment,
    organizationId,
    senderAddress: senderAddress as InpostConnectionConfig['senderAddress'],
  };
}

async function resolveApiToken(
  connection: Connection,
  credentialsResolver: CredentialsResolverPort,
): Promise<string> {
  if (!connection.credentialsRef) {
    throw new InpostConfigException(
      `Connection ${connection.id} has no credentialsRef`,
      connection.id,
    );
  }
  const credentials = await credentialsResolver.get<InpostCredentials>(connection.credentialsRef);
  if (!credentials?.apiToken) {
    throw new InpostConfigException(
      `Connection ${connection.id} credentials are missing apiToken`,
      connection.id,
    );
  }
  return credentials.apiToken;
}
