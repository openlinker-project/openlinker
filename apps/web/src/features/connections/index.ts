/**
 * Connections — public surface
 *
 * Public barrel for the connections feature. Anything other features or
 * plugins consume must be re-exported here; deep imports into
 * `features/connections/api|hooks|components|...` are banned by ESLint
 * for cross-feature consumers (#609).
 *
 * Same-feature internals continue to use relative imports as before.
 */
export type {
  BankAccount,
  SubiektBankAccount,
  SubiektCashRegister,
  Connection,
  ConnectionStatus,
  ConnectionFilters,
  ConnectionTestResult,
  ConnectionDiagnostics,
  RecentJobSummary,
  InstallWebhooksResult,
  RotateWebhookSecretResult,
  WebhookStatus,
  WebhookActivation,
  WebhookSignatureState,
  CreateConnectionInput,
  UpdateConnectionInput,
  PlatformType,
  CoreCapability,
} from './api/connections.types';
export { CORE_PLATFORM_TYPES, CORE_CAPABILITY_VALUES } from './api/connections.types';

export { useConnectionsQuery } from './hooks/use-connections-query';
export { useConnectionQuery } from './hooks/use-connection-query';
export { useCreateConnectionMutation } from './hooks/use-create-connection-mutation';
export { useProductMasterConnections } from './hooks/use-product-master-connections';
export { useConfigureWebhooksMutation } from './hooks/use-configure-webhooks-mutation';
export { useRotateWebhookSecretMutation } from './hooks/use-rotate-webhook-secret-mutation';
export { useSetWebhookSecretMutation } from './hooks/use-set-webhook-secret-mutation';
export { useWebhookStatusQuery } from './hooks/use-webhook-status-query';
export { useUpdateConnectionCredentialsMutation } from './hooks/use-update-connection-credentials-mutation';
export { useUpdateConnectionMutation } from './hooks/use-update-connection-mutation';
export { useBankAccountsQuery } from './hooks/use-bank-accounts-query';
export { useSetDefaultBankAccountMutation } from './hooks/use-set-default-bank-account-mutation';
export { usePickBankAccount } from './hooks/use-pick-bank-account';
export { useSubiektBankAccountsQuery } from './hooks/use-subiekt-bank-accounts-query';
export { useSubiektCashRegistersQuery } from './hooks/use-subiekt-cash-registers-query';

export {
  INVOICE_TRIGGER_MODEL_VALUES,
  INVOICE_TRIGGER_MODEL_LABELS,
} from './types/invoice-trigger-model.types';
export type { InvoiceTriggerModel } from './types/invoice-trigger-model.types';

// Edit-connection schema seam (#1330) — composed by the host with a platform's
// `ConnectionConfigContribution`; exported so plugin-local tests can exercise
// their contribution through the same composition path the form uses.
export {
  buildEditConnectionSchema,
  mergeStructuredIntoConfig,
} from './components/edit-connection.schema';
export type {
  EditConnectionStructuredPatch,
  EditConnectionFormValues,
} from './components/edit-connection.schema';

export { ConnectionEntityLabel } from './components/ConnectionEntityLabel';
export { AllegroSellerDefaultsSection } from './components/allegro-seller-defaults-section';
export { CapabilityTogglesSection } from './components/CapabilityTogglesSection';
export type { CapabilityTogglesSectionProps } from './components/CapabilityTogglesSection';
