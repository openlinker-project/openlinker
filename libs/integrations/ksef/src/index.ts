/**
 * @openlinker/integrations-ksef — Public Barrel
 *
 * KSeF Public API v2 invoicing/clearance adapter plugin (#1144 / C2 skeleton).
 * The runtime entry the host composes is `KsefIntegrationModule`; this barrel
 * also exports the static `ksefAdapterManifest` (#575 pattern) and the plugin
 * factory. C2 ships the plugin skeleton + manifest + connection config/
 * credentials shape validators + the stub `Invoicing` capability adapter. The
 * HTTP client (C3), issuance mechanics (C4), and `RegulatoryTransmitter`
 * clearance sub-capability land in the follow-up KSeF issues; see ADR-026 for
 * the country-agnostic invoicing decisions they build on.
 *
 * @module libs/integrations/ksef/src
 */

// Plugin descriptor + static manifest (#575)
export { ksefAdapterManifest, createKsefPlugin } from './ksef-plugin';

// Host wiring
export { KsefIntegrationModule } from './ksef-integration.module';

// Per-connection construction-seam contract — mirrors IErliAdapterFactory.
export type { IKsefAdapterFactory, KsefAdapters } from './application/interfaces/ksef-adapter.factory.interface';

// Shape validators — exported so host-side tests can register the real
// validators (mirrors the Allegro/Erli precedent).
export { KsefConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/ksef-connection-config-shape-validator.adapter';
export { KsefConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/ksef-connection-credentials-shape-validator.adapter';

// Connection config/credentials shapes (adapter-internal vocab, ADR-026).
export {
  KsefAuthTypeValues,
  KsefEnvironmentValues,
  type KsefAuthType,
  type KsefConnectionConfig,
  type KsefCredentials,
  type KsefEnvironment,
  type KsefSellerConfig,
} from './domain/types/ksef-connection.types';

// Domain exceptions. The HTTP client + interface stay package-private; these
// typed exceptions are the public surface — they feed the `KsefRetryClassifier`
// the plugin registers in `register(host)` (so terminal KSeF failures are
// non-retryable). An AuthFailureClassifier (reauth on 401, ADR-008) is a future
// hook and is not registered yet.
export { KsefApiException } from './domain/exceptions/ksef-api.exception';
export { KsefAuthenticationException } from './domain/exceptions/ksef-authentication.exception';
export { KsefConfigException } from './domain/exceptions/ksef-config.exception';
// Transport + session-crypto exceptions (#1147 / C3).
export { KsefNetworkException } from './domain/exceptions/ksef-network.exception';
export { KsefSessionCryptoException } from './domain/exceptions/ksef-session-crypto.exception';
// Online-session business-failure (zero-valid processed session) — surfaced to
// the host classifier / core InvoiceService as a terminal failure (#1149 / C5).
export { KsefSessionException } from './domain/exceptions/ksef-session.exception';
// Unsupported requested document type — a terminal input error (#1149 / C5).
export { KsefUnsupportedDocumentTypeException } from './domain/exceptions/ksef-unsupported-document-type.exception';
// documentType <-> correction command-shape mismatch — a terminal input error (#1151 / C7).
export { KsefInvalidCorrectionException } from './domain/exceptions/ksef-invalid-correction.exception';

// FA(3) build/mapping + structural-validation exceptions (#1148 / C4). Public
// so the host classifier / persistence layer can pattern-match a deterministic
// build fault (mark the InvoiceRecord failed) vs a transient transport error.
export {
  Fa3BuildException,
  InvalidBuyerIdentificationException,
  UnmappedTaxRateException,
  UnsupportedCurrencyException,
} from './domain/exceptions/fa3-builder.exception';
export {
  Fa3XsdValidationException,
  type Fa3ValidationIssue,
} from './domain/exceptions/fa3-validation.exception';
