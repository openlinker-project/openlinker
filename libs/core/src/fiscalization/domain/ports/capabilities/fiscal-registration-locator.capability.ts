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
  FiscalLocateAnswer,
  FiscalLocateCriteria,
} from '../../types/fiscalization.types';
import type { FiscalizationPort } from '../fiscalization.port';

export interface FiscalRegistrationLocator {
  /**
   * Look the registration up at the provider by business coordinates.
   *
   * Answers with one of the three {@link FiscalLocateAnswer} outcomes: the
   * neutral identity set when the provider CONFIRMS a registration, `held` when
   * it has the sale but has not registered it, and `not-found` when it holds
   * nothing for these coordinates. The `held` outcome exists because reporting
   * normal in-provider processing as an absence is what made the operator
   * surface say the sale was missing while it was being handled (ADR-042
   * amendment #2502, decision 1).
   *
   * A transport/infra failure THROWS, for the caller to retry - a throw must
   * never be read as "no match", and it is not one of the three answers.
   *
   * The pre-#2502 `FiscalLocateResult | null` shape is still accepted at
   * runtime: callers normalise through `readFiscalLocateAnswer`, so an
   * out-of-tree adapter compiled against an older `libs/core` keeps working.
   */
  locateByQuery(criteria: FiscalLocateCriteria): Promise<FiscalLocateAnswer>;
}

export function isFiscalRegistrationLocator(
  adapter: FiscalizationPort,
): adapter is FiscalizationPort & FiscalRegistrationLocator {
  return typeof (adapter as Partial<FiscalRegistrationLocator>).locateByQuery === 'function';
}
