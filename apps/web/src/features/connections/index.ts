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
  Connection,
  ConnectionStatus,
  ConnectionFilters,
  ConnectionTestResult,
  ConnectionDiagnostics,
  RecentJobSummary,
  InstallWebhooksResult,
  CreateConnectionInput,
  UpdateConnectionInput,
  PlatformType,
  CoreCapability,
} from './api/connections.types';
export { CORE_PLATFORM_TYPES, CORE_CAPABILITY_VALUES } from './api/connections.types';

export { useConnectionsQuery } from './hooks/use-connections-query';
export { useProductMasterConnections } from './hooks/use-product-master-connections';
export { useConfigureWebhooksMutation } from './hooks/use-configure-webhooks-mutation';
export { useUpdateConnectionCredentialsMutation } from './hooks/use-update-connection-credentials-mutation';

export {
  INVOICE_TRIGGER_MODEL_VALUES,
  INVOICE_TRIGGER_MODEL_LABELS,
} from './types/invoice-trigger-model.types';
export type { InvoiceTriggerModel } from './types/invoice-trigger-model.types';

export { ConnectionEntityLabel } from './components/ConnectionEntityLabel';
export { AllegroSellerDefaultsSection } from './components/allegro-seller-defaults-section';
export { CapabilityTogglesSection } from './components/CapabilityTogglesSection';
export type { CapabilityTogglesSectionProps } from './components/CapabilityTogglesSection';
