/**
 * Fiscal Registration Locator Capability
 *
 * Optional sub-capability of {@link FiscalizationPort} (ADR-002 composition,
 * ADR-042 decision 7). A provider that can be queried by business coordinates
 * declares `implements FiscalizationPort, FiscalRegistrationLocator`.
 *
 * It answers the one question OL cannot answer from its own state after an
 * indeterminate call: did the sale actually get registered? OL holds no
 * provider reference at that point - the call died before one came back - so the
 * lookup has to key on business coordinates instead.
 *
 * Call sites resolve the `'Fiscalization'` adapter, narrow with
 * {@link isFiscalRegistrationLocator}, and skip when a provider does not
 * implement it. A provider exposing no query surface gets MANUAL operator
 * handling; it never gets a blind resend, because a resend of a registration
 * that already landed is the double-registration this whole contract exists to
 * prevent.
 *
 * @module libs/core/src/fiscalization/domain/ports/capabilities
 */
import type {
  FiscalLocateCriteria,
  FiscalLocateResult,
} from '../../types/fiscalization.types';
import type { FiscalizationPort } from '../fiscalization.port';

export interface FiscalRegistrationLocator {
  /**
   * Look the registration up at the provider by business coordinates. Returns
   * the neutral identity set when the provider holds a match, or `null` when it
   * holds none. A transport/infra failure throws, for the caller to retry - a
   * throw must never be read as "no match".
   */
  locateByQuery(criteria: FiscalLocateCriteria): Promise<FiscalLocateResult | null>;
}

export function isFiscalRegistrationLocator(
  adapter: FiscalizationPort,
): adapter is FiscalizationPort & FiscalRegistrationLocator {
  return typeof (adapter as Partial<FiscalRegistrationLocator>).locateByQuery === 'function';
}
