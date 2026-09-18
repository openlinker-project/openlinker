/**
 * eparagony.pl Integration - Public API
 *
 * Barrel for `@openlinker/integrations-eparagony`. Exports the plugin descriptor
 * factory, the static manifest (#575), the NestJS module the host imports, and
 * the pieces host-side tests need to register the real adapters - BOTH of them
 * since #3192: one connection carries the receipt lane and the invoice lane.
 *
 * The HTTP client stays package-private (siblings keep theirs private too): it
 * closes over one connection's client secret and token cache, and nothing
 * outside the package should build one.
 *
 * @module libs/integrations/eparagony/src
 */

export { createEparagonyPlugin, eparagonyAdapterManifest } from './eparagony-plugin';
export { EparagonyIntegrationModule } from './eparagony-integration.module';

export {
  EPARAGONY_ADAPTER_KEY,
  EPARAGONY_BRAND,
  EPARAGONY_PROVIDER_TYPE,
} from './eparagony.constants';

export { EparagonyFiscalizationAdapter } from './infrastructure/adapters/eparagony-fiscalization.adapter';
export { EparagonyInvoicingAdapter } from './infrastructure/adapters/eparagony-invoicing.adapter';

// Shape validators + classifiers - exported so host-side tests can register the
// real adapters (mirrors the Infakt/KSeF precedent).
export { EparagonyConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/eparagony-connection-config-shape-validator.adapter';
export { EparagonyConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/eparagony-connection-credentials-shape-validator.adapter';
export { EparagonyConnectionTesterAdapter } from './infrastructure/adapters/eparagony-connection-tester.adapter';
export { EparagonyRetryClassifierAdapter } from './infrastructure/adapters/eparagony-retry-classifier.adapter';
export { EparagonyAuthFailureClassifierAdapter } from './infrastructure/adapters/eparagony-auth-failure-classifier.adapter';

export { EparagonyApiError } from './domain/exceptions/eparagony-api.error';
export type { EparagonyFailureMode } from './domain/exceptions/eparagony-api.error';
export { EparagonyConfigException } from './domain/exceptions/eparagony-config.exception';
export { EparagonyNetworkError } from './domain/exceptions/eparagony-network.error';

export {
  deriveDocumentToken,
  deriveTransactionToken,
} from './domain/policies/document-token.policy';
export { EPARAGONY_DEFAULT_TAX_RATES } from './domain/policies/tax-rate.policy';
export { resolveInvoiceTaxRateCode } from './domain/policies/invoice-tax-rate.policy';

export {
  EparagonyEnvironmentValues,
  EparagonyPaymentFormValues,
  EparagonyTaxRateCodeValues,
} from './domain/types/eparagony-config.types';
export type {
  EparagonyConnectionConfig,
  EparagonyEnvironment,
  EparagonyPaymentForm,
  EparagonySellerAddress,
  EparagonyTaxRateCode,
  EparagonyTaxRateTable,
} from './domain/types/eparagony-config.types';
export { EparagonyInvoiceTaxRateValues } from './domain/types/eparagony-api.types';
export type { EparagonyInvoiceTaxRate } from './domain/types/eparagony-api.types';
export type { EparagonyCredentials } from './domain/types/eparagony-credentials.types';
