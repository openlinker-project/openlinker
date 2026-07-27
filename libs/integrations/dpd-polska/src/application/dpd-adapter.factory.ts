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
import { getDpdServicesBaseUrl } from '../infrastructure/http/dpd-hosts';
import { DpdInfoSoapClient } from '../infrastructure/http/dpd-info-soap-client';

// DPD InfoServices SOAP tracking endpoint (#965 / ADR-022). A SEPARATE host
// from the REST shipment API above — `dpdinfoservices.dpd.com.pl` (PROD,
// confirmed from INFO_Services_v2 §1.4), ObjEvents interface. The demo host
// follows the `…demo…` naming pattern; // TODO confirm against the demo WSDL.
const INFO_BASE_URLS: Readonly<Record<DpdEnvironment, string>> = {
  sandbox: 'https://dpdinfoservicesdemo.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents',
  production: 'https://dpdinfoservices.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents',
};

export async function createDpdShippingAdapter(
  connection: Connection,
  credentialsResolver: CredentialsResolverPort,
): Promise<DpdShippingAdapter> {
  const config = extractConfig(connection);
  const credentials = await resolveCredentials(connection, credentialsResolver);
  const client = new DpdHttpClient(getDpdServicesBaseUrl(config.environment), {
    login: credentials.login,
    password: credentials.password,
    masterFid: config.masterFid,
  });
  // InfoServices tracking auth is `login`/`password` in the SOAP body (channel
  // empty for the waybill method) — masterFid is shipment-only (ADR-022).
  const infoClient = new DpdInfoSoapClient(INFO_BASE_URLS[config.environment], {
    login: credentials.login,
    password: credentials.password,
  });
  return new DpdShippingAdapter(client, config, infoClient);
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
