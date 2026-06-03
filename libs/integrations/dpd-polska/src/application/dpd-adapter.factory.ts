/**
 * DPD Polska Adapter Factory
 *
 * Builds a per-connection `DpdShippingAdapter`: reads + defensively validates
 * the connection config, resolves the DPDServices Basic-auth pair via the host
 * `CredentialsResolverPort`, selects the environment base URL, and wires the
 * HTTP client. Invoked from the plugin's `createCapabilityAdapter`. Config
 * *shape* is enforced earlier by the connection-config validator at
 * create/update time; this factory's checks are a runtime safety net that
 * raises `DpdConfigException` on a malformed/under-provisioned connection.
 *
 * @module libs/integrations/dpd-polska/src/application
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { DpdConfigException } from '../domain/exceptions/dpd-config.exception';
import type { DpdConnectionConfig, DpdEnvironment } from '../domain/types/dpd-config.types';
import { DpdEnvironmentValues } from '../domain/types/dpd-config.types';
import type { DpdCredentials } from '../domain/types/dpd-credentials.types';
import { DpdShippingAdapter } from '../infrastructure/adapters/dpd-shipping.adapter';
import { DpdHttpClient } from '../infrastructure/http/dpd-http-client';

// OQ-3 (#962): test is credentials-gated, not host-gated — both environments
// resolve to the same DPDServices host today. Split here if a sandbox host
// surfaces; nothing else changes.
const BASE_URLS: Readonly<Record<DpdEnvironment, string>> = {
  sandbox: 'https://dpdservices.dpd.com.pl',
  production: 'https://dpdservices.dpd.com.pl',
};

export async function createDpdShippingAdapter(
  connection: Connection,
  credentialsResolver: CredentialsResolverPort,
): Promise<DpdShippingAdapter> {
  const config = extractConfig(connection);
  const credentials = await resolveCredentials(connection, credentialsResolver);
  const client = new DpdHttpClient(BASE_URLS[config.environment], {
    login: credentials.login,
    password: credentials.password,
    masterFid: config.masterFid,
  });
  return new DpdShippingAdapter(client, config);
}

function extractConfig(connection: Connection): DpdConnectionConfig {
  const raw = (connection.config ?? {}) as Record<string, unknown>;

  const environment = raw.environment;
  if (typeof environment !== 'string' || !DpdEnvironmentValues.includes(environment as DpdEnvironment)) {
    throw new DpdConfigException(
      `Connection ${connection.id} has invalid or missing DPD environment`,
      connection.id,
    );
  }

  const payerFid = raw.payerFid;
  if (typeof payerFid !== 'string' || !/^\d+$/.test(payerFid)) {
    throw new DpdConfigException(
      `Connection ${connection.id} has invalid or missing payerFid (numeric string required)`,
      connection.id,
    );
  }

  const masterFid = raw.masterFid;
  if (masterFid !== undefined && (typeof masterFid !== 'string' || !/^\d+$/.test(masterFid))) {
    throw new DpdConfigException(
      `Connection ${connection.id} has an invalid masterFid (numeric string required when present)`,
      connection.id,
    );
  }

  const senderAddress = raw.senderAddress;
  if (typeof senderAddress !== 'object' || senderAddress === null) {
    throw new DpdConfigException(
      `Connection ${connection.id} is missing senderAddress`,
      connection.id,
    );
  }

  return {
    environment: environment as DpdEnvironment,
    payerFid,
    masterFid: masterFid,
    senderAddress: senderAddress as DpdConnectionConfig['senderAddress'],
  };
}

async function resolveCredentials(
  connection: Connection,
  credentialsResolver: CredentialsResolverPort,
): Promise<DpdCredentials> {
  if (!connection.credentialsRef) {
    throw new DpdConfigException(`Connection ${connection.id} has no credentialsRef`, connection.id);
  }
  const credentials = await credentialsResolver.get<DpdCredentials>(connection.credentialsRef);
  if (!credentials?.login || !credentials?.password) {
    throw new DpdConfigException(
      `Connection ${connection.id} credentials are missing login/password`,
      connection.id,
    );
  }
  return { login: credentials.login, password: credentials.password };
}
