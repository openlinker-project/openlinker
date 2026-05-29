/**
 * OpenLinker FE Plugin Contract
 *
 * Single unified shape for an in-tree FE plugin (#702). A plugin contributes
 * to two lifecycles via namespaced sub-records:
 *
 *   - `build` — composed at module load by the host: routes, nav items,
 *     API client namespaces, offer-creation wizard contributions. Iterated
 *     by `createApiClient`, the router, and `nav-registry.ts`.
 *
 *   - `platform` — resolved at render time via React context: setup card,
 *     edit-form sections, credentials panel, connection actions, content
 *     publish-error extractor. Looked up by `usePlatform(platformType)` /
 *     `usePlatforms()`.
 *
 * `platformType` lives at the top level because the runtime lookup keys
 * off it (`plugins.find(p => p.platformType === target)`). A plugin that
 * only contributes build-time concerns may omit `platformType` and
 * `platform`; a plugin that contributes platform-side UI must set both.
 * The registry barrel enforces that pair-invariance at module load.
 *
 * Mirrors the BE `AdapterPlugin` / `PluginEntry` shape at conceptual level
 * (#572 / #593) — same intent, structurally different (the FE has no DI
 * container; everything is plain objects).
 *
 * @module shared/plugins
 */
import type { ComponentType } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { RouteObject } from 'react-router-dom';

import type { ApiRequest, PluginApiNamespaces } from '../../app/api/api-client';
import type { Role } from '../../app/nav-registry.types';
import type { Connection } from '../../features/connections/api/connections.types';
import type { EditConnectionFormValues } from '../../features/connections/components/edit-connection.schema';
import type { CreateOfferRequest } from '../../features/listings';
import type { StructuredError } from '../types/structured-error.types';

/**
 * One nav-link contribution from a plugin. `groupLabel` is an open string:
 * a contribution whose label matches an existing nav group is appended to
 * that group; an unknown label creates a new group at the end of the sidebar.
 *
 * Soft contract: contributors should prefer matching one of the existing
 * groups ("Operations", "Diagnostics", "Platform"). Tightening to a closed
 * union is a follow-up if group sprawl becomes a problem.
 *
 * Note: `countKey` is intentionally omitted — count badges are wired to
 * internal queries via a closed key set (`NavCountKey`), not a plugin
 * concern in MVP.
 */
export interface NavContribution {
  groupLabel: string;
  to: string;
  label: string;
  end?: boolean;
  /**
   * Declarative role gate (#610). When set, the contribution is dropped for
   * sessions whose role doesn't match — same UI-hide semantics as the AI
   * group's `requiresRole: 'admin'` on `BASE_NAV_GROUPS`. Authorization is
   * still enforced backend-side; this only hides the nav affordance.
   */
  requiresRole?: Role;
}

/**
 * Factory called once at `createApiClient` composition time. Receives the
 * core `request` function (already wrapped with auth + error normalisation)
 * and returns the namespaces this plugin wants to expose on `ApiClient`.
 *
 * Plugins extend `PluginApiNamespaces` via TS declaration merging:
 *
 * ```ts
 * declare module '../../app/api/api-client' {
 *   interface PluginApiNamespaces {
 *     allegro: AllegroApi;
 *   }
 * }
 * ```
 */
export type PluginApiNamespacesFactory = (
  request: ApiRequest,
) => Partial<PluginApiNamespaces>;

/**
 * Props every per-platform offer-creation wizard receives. The launcher
 * (`features/listings/components/OfferCreationLauncher.tsx`) resolves the
 * connection up front and owns the surrounding Dialog chrome — so each
 * contributed wizard is **content-only**, knows its platform via
 * `connection.platformType`, and never renders its own Dialog or
 * connection picker (#608).
 *
 * `defaultVariantId` / `initialValues` carry retry-path hints.
 */
export interface OfferCreationWizardProps {
  connection: Connection;
  defaultVariantId?: string;
  initialValues?: CreateOfferRequest;
  /** Fired by the wizard's Cancel/Close affordance — the launcher uses
   *  this to close the surrounding Dialog. */
  onCancel: () => void;
  onSubmitted: (offerCreationRecordId: string, connectionId: string) => void;
}

/**
 * Plugin contribution for capability-shaped offer creation (#608).
 *
 * `component` is a pre-bound React component, not a render fn — keeps the
 * contribution a pure value at module load, plays nicely with test mocks,
 * and matches how React expects to consume components at JSX time
 * (`<contribution.component {...props} />`).
 */
export interface OfferCreationWizardContribution {
  /** Connection `platformType` this wizard handles, e.g. 'allegro'. */
  platformType: string;
  component: ComponentType<OfferCreationWizardProps>;
}

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

/**
 * Build-time contribution bag. Folded by the host at module load.
 */
export interface BuildContribution {
  /** React Router route objects appended to the root route's children. */
  routes?: RouteObject[];
  /** Sidebar nav items merged into the existing nav groups by label. */
  navItems?: NavContribution[];
  /** Factory that produces typed API client namespaces. */
  apiNamespaces?: PluginApiNamespacesFactory;
  /** Per-platform offer-creation wizard registered against the
   *  `OfferCreationLauncher` dispatch site (#608). */
  offerCreationWizard?: OfferCreationWizardContribution;
}

/**
 * Platform-side contribution bag. Resolved at render time via context.
 * Sibling to `BuildContribution` on the same plugin object — a plugin
 * representing a platform sets both.
 */
export interface PlatformContribution {
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
   * `true` when the platform's order pickup-point payload resolves
   * asynchronously after the order is received — the buyer selects the
   * locker on the platform, but it arrives on a later platform poll.
   * Drives:
   *   - `OrderShipmentPanel`'s paczkomat-row caption ("buyer-selected via
   *     {displayName}" vs. "operator-selected")
   *   - `GenerateLabelForm`'s pickup-point retry hint (#839 AC-3)
   * Omit for platforms where the pickup-point arrives synchronously with the
   * order payload.
   */
  pickupPointResolvesAsync?: boolean;
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

/**
 * The unified plugin shape (#702).
 *
 * Invariant: a plugin contributing platform-side affordances must set both
 * `platformType` (top-level discriminator) and `platform` (the bag). A
 * build-only plugin omits both. The registry barrel asserts this at module
 * load via `assertUniquePluginInvariants`.
 */
export interface OpenLinkerPlugin {
  /** Stable id, kebab-case. Must be unique across the registry. */
  id: string;
  /**
   * Stable key matching `connection.platformType`. Required iff `platform`
   * is set; null otherwise. The runtime context lookup keys on this value.
   */
  platformType?: string;
  /** Build-time contributions. Folded by the host at module load. */
  build?: BuildContribution;
  /** Platform-side contributions. Resolved at render time via context. */
  platform?: PlatformContribution;
}

/**
 * Flattened platform view returned by `usePlatform(target)` / `usePlatforms()`.
 * Preserves the field-access shape the original `PlatformPlugin` contract
 * exposed — call sites read `platform.displayName`, `platform.setupCard`,
 * `platform.platformType` etc. directly without a `.platform.` chain.
 */
export type Platform = { platformType: string } & PlatformContribution;
