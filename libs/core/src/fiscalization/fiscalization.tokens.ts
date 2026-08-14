/**
 * Fiscalization Module Dependency Injection Tokens
 *
 * Symbol tokens for the fiscalization bounded context. The `FiscalizationPort`
 * itself is capability-resolved per connection (no fixed token) - only the
 * repository port and the application service need a binding token.
 *
 * @module libs/core/src/fiscalization
 */
export const FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN = Symbol(
  'FiscalRegistrationRecordRepositoryPort',
);

export const FISCAL_REGISTRATION_SERVICE_TOKEN = Symbol('IFiscalRegistrationService');
