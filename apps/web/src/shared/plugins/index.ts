/**
 * Plugin Registry Public Surface
 *
 * Re-exports the unified plugin contract (#702) and the runtime resolution
 * hooks consumed by features, pages, and the app composition root. The
 * actual plugin instances live in `apps/web/src/plugins/` and are wired
 * into the provider via the `plugins` array exported from
 * `apps/web/src/plugins/index.ts`.
 *
 * @module shared/plugins
 */
export type {
  OpenLinkerPlugin,
  BuildContribution,
  PlatformContribution,
  Platform,
  PlatformSetupCard,
  ConnectionConfigContribution,
  PluginEditConnectionFields,
  StructuredConfigSectionProps,
  ExtraConfigSectionProps,
  NavContribution,
  ShopProductPublishWizardContribution,
  ShopProductPublishWizardProps,
  PluginApiNamespacesFactory,
  BulkConfigFormValues,
  BulkOfferConfigSectionProps,
  BulkOfferConfigSectionContribution,
  BulkOfferRowSectionProps,
  OfferBlockerTone,
  OfferBlockerDescriptor,
  OfferRowValidationInput,
  OfferValidationContribution,
  InvoiceDetailSectionProps,
  InvoiceCorrectionFlowProps,
} from './plugin.types';
export { readConfigString, readOptionalConfigString } from './config-readers';
export { PluginRegistryProvider, PluginRegistryContext } from './plugin-registry-context';
export { usePlatforms } from './use-platforms';
export { usePlatform } from './use-platform';
