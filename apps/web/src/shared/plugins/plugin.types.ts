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
import type { RefinementCtx, ZodType } from 'zod';

import type { ApiRequest, PluginApiNamespaces } from '../../app/api/api-client';
import type { Role } from '../../app/nav-registry.types';
import type { Connection } from '../../features/connections/api/connections.types';
import type { EditConnectionFormValues } from '../../features/connections/components/edit-connection.schema';
import type { InvoiceRecord } from '../../features/invoicing';
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
export type PluginApiNamespacesFactory = (request: ApiRequest) => Partial<PluginApiNamespaces>;

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
 * Props every per-platform shop-publish wizard receives (#1044). Mirrors
 * `OfferCreationWizardProps` — the launcher
 * (`features/listings/components/ShopPublishLauncher.tsx`) resolves the shop
 * connection up front and owns the surrounding Dialog chrome, so each
 * contributed wizard is **content-only**, knows its platform via
 * `connection.platformType`, and never renders its own Dialog or connection
 * picker.
 *
 * `defaultVariantId` carries the single-publish target; `defaultVariantIds`
 * (>1) drives bulk mode. `onSubmitted` reports either a single
 * `recordId` (single submit) or a `batchId` (bulk submit) so the launcher
 * can swap to the matching tracker.
 */
export interface ShopProductPublishWizardProps {
  connection: Connection;
  defaultVariantId?: string;
  defaultVariantIds?: string[];
  /** Fired by the wizard's Cancel/Close affordance — the launcher uses
   *  this to close the surrounding Dialog. */
  onCancel: () => void;
  onSubmitted: (result: { recordId?: string; batchId?: string }, connectionId: string) => void;
}

/**
 * Plugin contribution for capability-shaped shop publishing (#1044).
 *
 * `component` is a pre-bound React component, not a render fn — same shape
 * as `OfferCreationWizardContribution`, keeping the contribution a pure
 * value at module load.
 */
export interface ShopProductPublishWizardContribution {
  /** Connection `platformType` this wizard handles, e.g. 'woocommerce'. */
  platformType: string;
  component: ComponentType<ShopProductPublishWizardProps>;
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
 * Plugin-contributed edit-connection form fields (#1330).
 *
 * TS declaration-merging seam, mirroring the `PluginApiNamespaces` precedent
 * (#605): a plugin that contributes a `ConnectionConfigContribution` also
 * augments this interface with the form-field names its Zod fragment adds, so
 * `form.register('sellerNip')` etc. stay statically typed inside the plugin's
 * `StructuredConfigSection`. Every merged field MUST be optional — the base
 * form (and every other platform's form) never carries it.
 *
 * The merge block enters the TS import graph through the plugin's entry in
 * `apps/web/src/plugins/index.ts`, same as `apiNamespaces`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface -- declaration-merging target; plugins populate it
export interface PluginEditConnectionFields {}

/**
 * Keys of `ConnectionConfigContribution.schemaShape`, constrained to the
 * field names plugins declaration-merge into `PluginEditConnectionFields`.
 * Ties the Zod fragment to the typed form fields at compile time - a plugin
 * cannot ship a schema entry for a field it never merged (which would be an
 * unvalidated, untyped `register()` path), and TS flags a typo'd key at the
 * contribution literal instead of failing silently at runtime.
 */
export type PluginConnectionConfigSchemaShape = {
  [K in keyof PluginEditConnectionFields]?: ZodType;
};

/**
 * Per-platform connection-config contribution (#1330). The non-render half of
 * a platform's structured-config editing: the render half is
 * `StructuredConfigSection`; this bag owns the Zod schema fragment, the
 * read-side hydration, and the write-side config assembly. Consumed by
 * `EditConnectionForm` (composed resolver + `defaultValues`) and
 * `mergeStructuredIntoConfig` (assembly pass). Absent ⇒ the platform has no
 * structured-config fields beyond the shared base schema.
 */
export interface ConnectionConfigContribution {
  /**
   * Zod field fragment merged into the edit-connection schema when editing a
   * connection of this platform. The keys are compiler-constrained to the
   * names the plugin merges into `PluginEditConnectionFields`, so a schema
   * entry without a matching declaration-merged form field is a type error
   * (an unmerged key would otherwise produce an untyped `register()` path).
   */
  schemaShape: PluginConnectionConfigSchemaShape;
  /**
   * Optional cross-field checks applied via `superRefine` on the composed
   * schema (e.g. KSeF's skonto both-or-neither pair).
   */
  superRefine?: (values: Record<string, unknown>, ctx: RefinementCtx) => void;
  /**
   * Hydrate this platform's form fields from a stored config (read side).
   * Must return a fully-populated slice — empty strings where the operator
   * hasn't filled a field yet — so RHF `register()` paths need no per-field
   * undefined guards.
   */
  readConfigToForm: (config: Record<string, unknown>) => Partial<PluginEditConnectionFields>;
  /**
   * Merge a PARTIAL structured patch into the config, returning a new config
   * (write side — assembly/normalization). Called per keystroke with
   * single-field patches: it MUST NOT drop sibling leaves absent from the
   * patch, and MUST preserve unknown config keys (the operator's raw-JSON
   * additions).
   */
  applyToConfig: (
    config: Record<string, unknown>,
    patch: Record<string, unknown>,
  ) => Record<string, unknown>;
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
  syncStructuredToJson: (field: string, value: string, options?: { markDirty?: boolean }) => void;
  /**
   * #759 — whole-object serializer the host threads in so a section can
   * re-serialize a structured RHF object field (e.g. `subiektCapabilities`)
   * into `configText` after it `setValue`s the field itself. Additive and
   * optional: existing plugins (PS/WC) ignore it. Mirrors the
   * `syncSellerDefaultsToJson` thread-through on `ExtraConfigSectionProps`,
   * but generic (takes no field argument — the section owns which form
   * field it just wrote, the host serializer reads current form state).
   * Early-returns when raw JSON is unparseable, so sections that depend on
   * it MUST gate their inputs on `configIsParseable`.
   */
  syncObjectToJson?: () => void;
  /**
   * #771 — whole-object serializer for the InPost sender address. Same shape as
   * `syncObjectToJson` (no field argument; the host serializer reads current
   * form state) but dedicated to `inpostSenderAddress` so it can coexist with
   * the subiekt-capabilities serializer on the same prop bag. Additive and
   * optional: existing plugins ignore it. Early-returns when raw JSON is
   * unparseable, so the InPost section gates its inputs on `configIsParseable`.
   */
  syncInpostSenderAddressToJson?: () => void;
  /**
   * #1303 follow-up — whole-object serializer for the Infakt bank-account
   * snapshot. Same shape as `syncInpostSenderAddressToJson` (no field
   * argument; the host serializer reads current form state) but dedicated
   * to `infaktBankAccount` so it can coexist with the other whole-object
   * serializers on the same prop bag. The Infakt section MUST
   * `setValue('infaktBankAccount', …)` BEFORE calling this.
   */
  syncInfaktBankAccountToJson?: () => void;
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
 * Bulk-offer config form values (#1096). The shared slice the host owns
 * (pricing/stock policy, currency, publish/AI toggles) plus an open
 * `platformParams` slot the per-platform section writes into. Owned by the
 * plugin contract (NOT `features/listings`) so plugins and the host bind
 * against one stable shape — and so `shared/plugins`'s narrow feature-import
 * allow-list (`.eslintrc.js`) isn't widened.
 */
export interface BulkConfigFormValues {
  pricingMode: 'use-master' | 'markup' | 'flat';
  markupPercent: string;
  flatPriceAmount: string;
  stockMode: 'use-master' | 'cap' | 'flat';
  capValue: string;
  flatStockValue: string;
  publishImmediately: boolean;
  generateDescription: boolean;
  /** Listing currency. Allegro section owns the picker; Erli fixes PLN. */
  currency: string;
  /** Open slot the platform section writes (deliveryPolicyId, dispatchTime, …). */
  platformParams: Record<string, unknown>;
}

/**
 * Props the per-platform bulk-offer config section receives (#1096). Mirrors
 * the `StructuredConfigSection` precedent: content-only, takes the parent RHF
 * form, registers its fields under `platformParams.*`.
 */
export interface BulkOfferConfigSectionProps {
  connection: Connection;
  form: UseFormReturn<BulkConfigFormValues>;
}

/**
 * Per-platform bulk-offer config section contribution (#1096). Lives on
 * `PlatformContribution` (render-time, resolved via `usePlatform`) — same
 * altitude as `StructuredConfigSection`/`ExtraConfigSection`, not `build`.
 * `isComplete` is a pure predicate the host ANDs into its `canProceed` gate
 * (the host validates the shared slice; the section validates its own fields).
 */
export interface BulkOfferConfigSectionContribution {
  component: ComponentType<BulkOfferConfigSectionProps>;
  isComplete: (values: BulkConfigFormValues) => boolean;
}

/**
 * Per-platform per-ROW config section for the bulk Review's edit modal (#1096),
 * letting an operator override a platform field for a single product (e.g. Erli
 * dispatch time) instead of only batch-wide. Controlled: the host owns the row's
 * `platformParams` (seeded from any existing per-row override) and the section
 * reads `platformParams` + emits the next value via `onChange`. A platform
 * typically gates its field behind a toggle so an untouched row inherits the
 * batch default (the submit deep-merges shared `platformParams` under per-row).
 * Resolved via `usePlatform(connection.platformType)`. Absent ⇒ no per-row
 * platform fields (price/stock are host-generic and already per-row editable).
 */
export interface BulkOfferRowSectionProps {
  connection: Connection;
  platformParams: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

/**
 * Chip tone for a per-platform offer blocker (#1096). Structurally matches
 * `StatusBadgeTone` from `shared/ui` — duplicated here so the plugin contract
 * doesn't depend on `shared/ui`. The chip render site (which already imports
 * `shared/ui`) accepts it where `StatusBadgeTone` is expected.
 */
export type OfferBlockerTone =
  | 'error'
  | 'info'
  | 'neutral'
  | 'review'
  | 'success'
  | 'warning';

/**
 * Static descriptor for a platform-specific offer blocker (#1096). The host
 * Review/single-wizard render the chip generically from these — a new
 * marketplace declares its blockers in its plugin with zero host enum edits.
 * `id` is an open-world namespaced string (e.g. `'erli:missing-image'`).
 */
export interface OfferBlockerDescriptor {
  id: string;
  tone: OfferBlockerTone;
  label: string;
}

/**
 * Neutral, host-mapped inputs a platform validator reads (#1096). NOT the
 * wizard's internal row type — the host translates its row → this shape at the
 * call site, keeping the contract free of `features/listings` types. Each
 * validator reads only the fields relevant to its platform.
 */
export interface OfferRowValidationInput {
  /** Resolved master image count (Erli requires ≥1). */
  imageCount: number;
  /** Submit category needs product params the operator hasn't supplied (Allegro). */
  needsProductParameters: boolean;
  /** A catalogue card will be linked, exempting product-param requirements (Allegro). */
  willLinkProductCard: boolean;
}

/**
 * Per-platform offer-validation contribution (#1096). Declares the platform's
 * blocker descriptors once and a pure row validator; serves BOTH the bulk
 * Review step and the single-offer wizard so a marketplace declares its
 * blockers in exactly one place. Lives on `PlatformContribution` (resolved via
 * `usePlatform`).
 */
export interface OfferValidationContribution {
  blockers: readonly OfferBlockerDescriptor[];
  /** Returns the active platform-specific blocker ids for a row. Pure. */
  validateRow: (input: OfferRowValidationInput) => string[];
  /**
   * Whether this platform's `validateRow` reads `needsProductParameters` (#1096).
   * The host's per-category required-product-parameter schema fetch
   * (`useBulkRequiredProductParams`, an Allegro #810 concern) is wasted work for
   * platforms whose validator ignores that input (e.g. Erli reads only
   * `imageCount`). Opt-in keeps the host neutral — it gates the fetch on this
   * flag rather than on a `platformType` string. Absent ⇒ treated as `false`.
   */
  needsCategoryParameterSchema?: boolean;
}

/**
 * Props the per-provider invoice detail section receives (#1240). Content-only
 * — the host owns the surrounding card chrome and the capability gate; the slot
 * renders the platform-specific regulatory region (KSeF: UPO + FA(3) + KSeF
 * number; Subiekt: read-only KSeF status + PDF). Resolved via
 * `usePlatform(connection.platformType)`. Absent ⇒ no provider region renders.
 * Reused by the order panel, the list-row affordances, and the detail page.
 */
export interface InvoiceDetailSectionProps {
  invoice: InvoiceRecord;
  connection: Connection;
}

/**
 * Props the per-provider correction flow receives (#1240, Wave C). Launched
 * from "Issue correction" on an issued invoice. The form is per-provider by
 * design (KSeF emits a KOR linked to the original KSeF number; Subiekt issues a
 * correcting document by adjusted quantity + price) — "a form for everything is
 * a form for nothing". Content-only; the host owns the Dialog chrome and closes
 * it on `onClose`. Resolved via `usePlatform(connection.platformType)`. Absent
 * ⇒ correction is unavailable for that provider.
 */
export interface InvoiceCorrectionFlowProps {
  invoice: InvoiceRecord;
  /** Optional: only KSeF, Subiekt, and inFakt implementers ignore it today. */
  connection?: Connection;
  onClose: () => void;
  onCorrectionIssued: (correctionInvoiceId: string) => void;
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
  /** Per-platform shop-publish wizard registered against the
   *  `ShopPublishLauncher` dispatch site (#1044). */
  shopProductPublishWizard?: ShopProductPublishWizardContribution;
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
  /**
   * Edit-connection: the non-render half of the platform's structured-config
   * editing (#1330) — Zod schema fragment, read-side hydration, write-side
   * config assembly. Consumed by `EditConnectionForm` when composing the
   * resolver schema / default values, and threaded into
   * `mergeStructuredIntoConfig` for the per-keystroke JSON sync. A platform
   * that renders a `StructuredConfigSection` with its own form fields must
   * also contribute this bag (and merge its field names into
   * `PluginEditConnectionFields`).
   */
  connectionConfig?: ConnectionConfigContribution;
  /**
   * #759 — adapter-provided capability-toggle descriptors. The generic
   * `CapabilityTogglesSection` renders one on/off switch per entry and
   * reads its label/help text from HERE, never from a literal in the
   * shared component (AC-8 international safety — e.g. the 'Show KSeF
   * status badge' label is provider-supplied). Keyed by capability id
   * (e.g. `regulatory-transmission-tracking`). Only Subiekt populates it
   * today; this is the general capability-toggle pattern.
   */
  capabilityDescriptors?: Record<string, { label: string; help?: string }>;
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
   *
   * `readOnly` is set when the panel is shown to a demo read-only viewer
   * (#1615): the action stays visible but its write buttons render disabled
   * with a read-only tooltip.
   */
  ConnectionActions?: ComponentType<{ connection: Connection; readOnly?: boolean }>;
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
  /**
   * Bulk offer creation: render the platform-specific bulk-config section
   * inside `bulk-config-step` (#1096). Same altitude as `StructuredConfigSection`
   * — a render-time, per-platform config form section resolved via
   * `usePlatform(platformType)`. (Contrast `build.offerCreationWizard`, which
   * is in `build` only because its launcher reaches it through an `app/`-tier
   * hook to dodge a `features → plugins` import; our consumers live in
   * `features/` and can call `usePlatform` directly.) Absent ⇒ the bulk-config
   * step renders a "marketplace not supported for bulk" fallback.
   */
  bulkOfferConfigSection?: BulkOfferConfigSectionContribution;
  /**
   * Bulk offer creation: render a platform-specific section in the Review
   * edit modal so an operator can override a platform field PER PRODUCT (e.g.
   * Erli dispatch time), not only batch-wide (#1096). Resolved via
   * `usePlatform(platformType)`. Absent ⇒ the edit modal shows only the
   * host-generic per-row fields (title, category, price, stock, description).
   */
  bulkOfferRowSection?: ComponentType<BulkOfferRowSectionProps>;
  /**
   * Bulk offer creation: per-connection override for whether the Review edit
   * modal shows the browsable category tree (`CategoryPicker` +
   * category-parameters step) instead of the manual Allegro-category-id
   * input. The default signal (`connection.supportedCapabilities.includes
   * ('CategoryBrowser')`) is a static, manifest-level flag — it can never be
   * true for a `borrows`-taxonomy destination like Erli, whose category
   * browsing is a *dynamic per-connection* toggle
   * (`config.allegroCategoryAccessEnabled`, set via the credentials panel),
   * not a capability the adapter always has. The single-offer
   * `ErliCreateOfferWizard` already reads this config flag directly; this
   * slot lets the bulk flow reach the same per-connection signal without a
   * `platformType ===` check in the shared bulk components. ORed with the
   * static capability check, never replacing it — a real `CategoryBrowser`
   * adapter (Allegro) keeps working with no contribution needed. Absent ⇒
   * only the static capability decides.
   */
  bulkCategoryBrowsingEnabled?: (connection: Connection) => boolean;
  /**
   * Offer creation: declare the platform's blocker chips + row validator once
   * (#1096), consumed by BOTH the bulk Review step and the single-offer wizard.
   * Resolved via `usePlatform(platformType)`. Absent ⇒ only the host-neutral
   * blockers (price/stock/category) apply.
   */
  offerValidation?: OfferValidationContribution;
  /**
   * Invoicing: render the platform-specific regulatory region of an invoice
   * (#1240). Content-only, resolved via `usePlatform(connection.platformType)`;
   * the host owns the card chrome and gates on the connection's regulatory
   * capability. KSeF (transmits directly) renders UPO + FA(3) + KSeF number;
   * Subiekt (transmits to KSeF natively) renders a read-only KSeF status + PDF
   * link. Reused by the order panel, list rows, and detail page. Absent ⇒ no
   * provider region renders (the neutral shell stands alone). Mirrors the
   * `bulkOfferRowSection` content-only precedent.
   */
  invoiceDetailSection?: ComponentType<InvoiceDetailSectionProps>;
  /**
   * Invoicing: render the platform-specific correction flow (#1240, Wave C).
   * Launched from "Issue correction" on an issued invoice; per-provider steps
   * by design. Resolved via `usePlatform(connection.platformType)`. Absent ⇒
   * the correction affordance is hidden for that provider.
   */
  invoiceCorrectionFlow?: ComponentType<InvoiceCorrectionFlowProps>;
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
