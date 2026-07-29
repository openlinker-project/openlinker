/**
 * DPD Polska DPDServices Host Resolver
 *
 * Single source of truth for the DPDServices REST base URL per environment.
 * Shared by the adapter factory (which wires the shipment client) and the
 * connection tester (which issues a cheap auth probe) so the two can't drift.
 *
 * OQ-3 (#962) RESOLVED: the DPDServices test environment is host-gated, not
 * credentials-gated. The demo account (login `test`, FID 1495) authenticates
 * only against the `…demo…` host — confirmed from the DPD-supplied DEMO Postman
 * environment (`DPD_SERVICES_REST_WSDL = https://dpdservicesdemo.dpd.com.pl/public`)
 * and a live auth probe. Sending demo creds to the production host returns 401.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/http
 */
import type { DpdEnvironment } from '../../domain/types/dpd-config.types';

const BASE_URLS: Readonly<Record<DpdEnvironment, string>> = {
  sandbox: 'https://dpdservicesdemo.dpd.com.pl',
  production: 'https://dpdservices.dpd.com.pl',
};

/** DPDServices REST base URL for the given environment. */
export function getDpdServicesBaseUrl(environment: DpdEnvironment): string {
  return BASE_URLS[environment];
}
