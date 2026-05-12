/**
 * Platform Plugin Contract
 *
 * Defines the shape of an in-tree FE plugin. Each registered plugin
 * represents one platform (e.g. PrestaShop, Allegro) and contributes the
 * platform-specific UI affordances that the core feature surfaces dispatch
 * to via `usePlugin(platformType)` / `usePlugins()` from this module.
 *
 * Mirrors `apps/api/src/plugins.ts` + `PluginRegistryModule.forRoot({ plugins })`
 * on the backend (#572). The FE counterpart of the modularity work that
 * landed in #570/#571/#576/#577.
 *
 * @module shared/plugins
 */
import type { ComponentType, ReactNode } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { Connection } from '../../features/connections/api/connections.types';
import type { EditConnectionFormValues } from '../../features/connections/components/edit-connection.schema';
import type { StructuredError } from '../types/structured-error.types';

/**
 * Setup-card metadata rendered on the connection-type picker
 * (`PlatformPicker`). Omit on plugins that don't expose a guided wizard
 * (advanced-mode-only platforms).
 */
export interface PlatformSetupCard {
  title: string;
  description: string;
  to: string;
  badge: string;
}

/**
 * Prop shape for the plugin-owned structured-config section in
 * `EditConnectionForm`. `syncStructuredToJson` accepts a wider `string` than
 * the parent's internal `StructuredField` union — the parent narrows at the
 * call site. Plugins should only pass field names that exist on
 * `EditConnectionFormValues`.
 */
export interface StructuredConfigSectionProps {
  connection: Connection;
  form: UseFormReturn<EditConnectionFormValues>;
  configIsParseable: boolean;
  syncStructuredToJson: (
    field: string,
    value: string,
    options?: { markDirty?: boolean },
  ) => void;
}

/**
 * Extra section rendered below the structured/raw config inputs. Allegro
 * uses this for the GPSR seller-defaults section. `syncSellerDefaultsToJson`
 * is the parent form's serialize helper — the section calls it on every
 * sub-field change so the raw `configText` stays in sync.
 */
export interface ExtraConfigSectionProps {
  connection: Connection;
  form: UseFormReturn<EditConnectionFormValues>;
  configIsParseable: boolean;
  syncSellerDefaultsToJson: () => void;
}

export interface PlatformPlugin {
  /** Stable key matching `connection.platformType`. */
  platformType: string;
  /** Human-readable display name (dropdown labels, etc.). */
  displayName: string;

  /** Setup-card metadata for `PlatformPicker`. Omit if no guided wizard. */
  setupCard?: PlatformSetupCard;
  /**
   * When true, the inline create-connection form replaces its submit
   * affordances with an Alert linking to the guided setup wizard (today:
   * Allegro OAuth). Named broadly so non-OAuth redirect flows (e.g. magic
   * link, device-code) can opt into the same UX.
   */
  requiresExternalAuthRedirect?: boolean;

  /** Edit-connection: default value for the OL callback URL field. */
  getCallbackUrlDefault?: () => string | undefined;
  /** Edit-connection: render the platform-specific structured config inputs. */
  StructuredConfigSection?: ComponentType<StructuredConfigSectionProps>;
  /** Edit-connection: render extra section below structured/raw. */
  ExtraConfigSection?: ComponentType<ExtraConfigSectionProps>;
  /**
   * Edit-connection: render the credentials panel (e.g. rotate-webservice-key
   * for PrestaShop). When omitted, the parent renders a generic read-only
   * "Stored securely (managed by integration)" affordance. Plugins that need
   * a custom rotation flow contribute the full panel so the form labels and
   * mutation payload match the platform's actual credential shape.
   */
  CredentialsPanel?: ComponentType<{ connection: Connection }>;

  /**
   * Connection-detail: contribute extra platform-specific actions to the
   * actions panel. Rendered as a sub-tree below the generic actions; the
   * component owns its mutation hooks and toast feedback.
   */
  ConnectionActions?: ComponentType<{ connection: Connection }>;

  /** Listing-detail: gate the "Edit offer" button on `ListingDetailPage`. */
  supportsListingEdit?: boolean;

  /**
   * Content feature: optional platform-specific structured-error extractor
   * for content-publish failures (#613). Given an unknown error thrown by
   * the publish mutation, return a `StructuredError[]` for inline rendering
   * by `StructuredErrorList`, or `null` if the error shape isn't one this
   * plugin recognises. Caller (`extractPlatformErrors`) iterates plugins
   * and returns the first non-null result, so the dispatch is
   * shape-based — the content-editor doesn't need to know which channel
   * produced the error.
   */
  extractContentPublishErrors?: (err: unknown) => StructuredError[] | null;
}

export type { ReactNode };
