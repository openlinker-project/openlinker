/**
 * Adapter Types
 *
 * Type definitions for adapter registry and capability system. Defines the
 * well-known core capability set, adapter-metadata structure, and adapter
 * instance types. Used by the adapter registry and integrations service for
 * runtime adapter resolution.
 *
 * @module libs/core/src/integrations/domain/types
 */
import type { ConnectionRateLimit } from '@openlinker/core/identifier-mapping';

/**
 * Well-known core capabilities — the documented set OpenLinker ships with.
 *
 * Plugin adapters can register additional capability names beyond this set
 * (#576). The runtime gate at `IntegrationsService.getCapabilityAdapter`
 * validates the requested capability against
 * `AdapterMetadata.supportedCapabilities`, which is the source of truth for
 * "is this capability supported?", regardless of whether the name appears
 * in `CoreCapabilityValues`.
 *
 * A name enters this array iff a call site resolves it BY CONNECTION ID through
 * `getCapabilityAdapter`. That rule is why `'FulfillmentRouter'` (ADR-052 A2,
 * sourcing) is deliberately absent: A2 is declared `capability: 'config-only'`
 * in `fulfillment-authority/domain/types/authority-kind.types.ts`, because
 * ADR-054/ADR-055 ship the router as a connection-backed plugin — candidacy is
 * configuration rather than a narrowed capability, and `resolveAuthorities`
 * skips the `supportedCapabilities` gate entirely for it. Landing the name
 * early would not be merely inert: an advertised name INVITES a later gate, and
 * because `enabledCapabilities` is stamped at connection-create and never
 * retro-filled (#2085), that gate would silently drain nothing for every
 * connection that already exists. This is exactly why #2220 kept
 * `ModifiedProductLister` out of this array and out of every manifest. The name
 * is re-admitted by whichever wave takes A2 off `'config-only'`; #2403 is the
 * record until then.
 */
export const CoreCapabilityValues = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'OfferManager',
  // Shop-listing (cross-platform listing, ADR-024). 'ProductPublisher' resolves
  // a `ShopProductManagerPort` (the base shop-listing port); 'CategoryProvisioner'
  // is its provision sub-capability.
  'ProductPublisher',
  'CategoryProvisioner',
  // Invoicing (ADR-026). Resolves an `InvoicingPort` (issuance mechanism);
  // regulatory transmission/clearance is a deferred ADR-002 sub-capability.
  'Invoicing',
  // Fiscalization (ADR-042). Resolves a `FiscalizationPort` - handing a completed
  // sale to a provider that performs or brokers its fiscal registration.
  // Deliberately NOT a document type on `Invoicing`: different issuer, device
  // dependency, legal basis and retry semantics.
  'Fiscalization',
  // Returns disposition authority (ADR-052 / #2351): who decides what happens
  // to goods a customer sends back. Unlike `ReturnSourceReader` / `ReturnDecliner`
  // — read off an adapter manifest and never written — this name is written by an
  // operator into `enabledCapabilities`, which both connection DTOs `@IsIn`-validate
  // against this array. Keeping it out would make it unwritable — necessary, but on
  // its own NOT sufficient: `ConnectionService` also validates the name against the
  // resolved adapter's `supportedCapabilities`, and no shipped manifest advertises
  // `ReturnsAuthority` yet, so A5 cannot resolve to a non-OpenLinker holder until an
  // adapter declares it.
  'ReturnsAuthority',
  // Availability read authority (ADR-052 A1 / #2403): who answers "how many can
  // I sell?" for a connection. `AUTHORITY_KIND_DESCRIPTORS.availability.capability`
  // names this string as A1's gate, so it is resolved by narrowing a dispatched
  // adapter — a dispatch name, not an advertised-without-dispatch one. No shipped
  // manifest advertises it yet, so it stays unassignable until one does.
  'AvailabilityAuthority',
  // Fulfilment execution authority (ADR-052 A3 / #2403): who holds a work object
  // and is allowed to act on it. `AUTHORITY_KIND_DESCRIPTORS['fulfillment-execution']
  // .capability` names this string as A3's gate. ADVERTISED since #2409 (openlinker.oms.v1).
  'FulfillmentExecutor',
] as const;

/**
 * Closed type for the well-known core capabilities.
 *
 * Use `CoreCapability` where exhaustiveness or strict validation matters
 * (HTTP DTOs, FE dropdowns). At extension boundaries (adapter metadata,
 * integrations service, exception constructors) the parameter / field
 * type is bare `string` with a JSDoc pointer back to {@link CoreCapability}.
 * The documentation lives in JSDoc; the type system reflects what the
 * runtime actually accepts.
 */
export type CoreCapability = (typeof CoreCapabilityValues)[number];

/**
 * Adapter metadata.
 *
 * Describes an adapter's capabilities and metadata. Used by AdapterRegistry
 * to resolve adapters at runtime. An adapter declares the capabilities its
 * factory can construct — never more: `IntegrationsService` trusts the
 * manifest when enumerating adapters, so a declared-but-undeliverable
 * capability would surface as a thrown factory error inside shared loops.
 * An empty array is valid for a registration-only plugin skeleton (the
 * platform is then inert — every gate filters it out before the factory
 * runs; precedent: the Erli skeleton, #980).
 *
 * `supportedCapabilities` is `string[]` so plugin
 * adapters can register capability names beyond the well-known core set
 * (#576). The runtime gate at `IntegrationsService.getCapabilityAdapter`
 * validates the requested capability against this array.
 */
export interface AdapterMetadata {
  /**
   * Versioned adapter key (e.g., 'prestashop.webservice.v1', 'allegro.publicapi.v1')
   */
  adapterKey: string;

  /**
   * Platform type identifier (e.g., 'prestashop', 'allegro')
   */
  platformType: string;

  /**
   * Array of capabilities supported by this adapter. Normally non-empty;
   * empty is permitted for registration-only skeletons (see the interface
   * docblock above). Must never declare a capability the adapter factory
   * cannot construct.
   * Open string set: well-known values come from {@link CoreCapabilityValues}
   * / {@link CoreCapability}; plugin adapters can register additional names
   * (#576). The runtime gate at `IntegrationsService.getCapabilityAdapter`
   * is the source of truth for "is this capability supported".
   */
  supportedCapabilities: string[];

  /**
   * Optional human-readable display name
   */
  displayName?: string;

  /**
   * Optional adapter version
   */
  version?: string;

  /**
   * When true, this adapter is the default for its platformType — i.e.
   * `IntegrationsService` resolves an unspecified `connection.adapterKey`
   * to this adapter's key. At most one default per platformType is
   * permitted; the registry rejects a second default registration with
   * `DuplicatePlatformDefaultException`. (#571)
   */
  isDefault?: boolean;

  /**
   * Declares how this destination groups sibling variants into one
   * buyer-facing listing, and therefore whether — and how consequentially —
   * a single variant may carry its own category (#1924).
   *
   * Advertised-without-dispatch, same as `CategoryBrowser` /
   * `EanCategoryMatcher` on Allegro (#1367) and `ShopCategoryBrowser` on
   * WooCommerce (#1834): read directly off the manifest for host/FE
   * discovery, never resolved through `getCapabilityAdapter` (it is not a
   * capability name).
   *
   * Absent when an adapter declares nothing — use
   * {@link resolveVariantGroupingModel} rather than reading this field
   * directly, so the most-restrictive default is always applied.
   */
  variantGrouping?: VariantGroupingModel;

  /**
   * Conservative resolution-time fallback for a connection with no explicit
   * `config.rateLimit` (#1810). Advertised, optional, no forced-dispatch
   * implication — same posture as `isDefault?` / `variantGrouping?`. Never
   * written into a connection's stored config; the effective policy is
   * `connection.config.rateLimit ?? metadata.defaultRateLimit`.
   *
   * Wired via `HttpTransportFactoryPort.forConnection(connection, defaultRateLimit?)`
   * (#1810 Phase 4) — each plugin's `createCapabilityAdapter` passes its own
   * manifest's `defaultRateLimit` as the second argument at the `host.http.forConnection(...)`
   * call site (see `PrestashopWebserviceClient`'s / PrestaShop's plugin for
   * the reference call site); `HttpTransportFactory` never imports
   * `AdapterMetadata` itself, so the value is threaded in structurally.
   */
  defaultRateLimit?: ConnectionRateLimit;

  /**
   * Whether a connection for this adapter must carry credentials (#2405,
   * ADR-055). Absent means `true` — every adapter that crosses a network
   * boundary needs them, so an adapter declaring nothing is unchanged.
   *
   * `false` relaxes `ConnectionService.create`'s credential guard
   * **capability-wise**: the OL-OMS holds no credentials because it crosses no
   * network boundary at all, answering from OpenLinker's own tables. The
   * relaxation deliberately keys on this declared field rather than on a
   * privileged `platformType === 'openlinker'` check, which would make the
   * host privilege one plugin by name and be unavailable to any third-party
   * OMS adapter.
   *
   * It relaxes ONLY the "neither supplied" arm. Supplying *both* credentials
   * and a `credentialsRef` stays a 400 at every setting — it is contradictory
   * input, and letting it through would encrypt and persist a credential row
   * nothing ever reads while silently discarding the caller's own ref.
   *
   * The resulting row carries `credentialsRef: ''` (the shipped Subiekt
   * precedent), which every resolution site already guards with
   * `if (credentialsRef)`. Read it through {@link resolveRequiresCredentials}
   * rather than directly, so the safe default is always applied.
   */
  requiresCredentials?: boolean;
}

/**
 * Variant-grouping model values (#1924).
 *
 * - `'catalog-implicit'` — siblings group by sharing a catalog product keyed
 *   by category (Allegro). Giving one variant its own category is a real,
 *   consequential choice: it splits that variant out of the grouped listing.
 * - `'explicit-group'` — grouping is carried by an explicit group id,
 *   independent of category (Erli's `externalVariantGroup`). A per-variant
 *   category is ordinary metadata — no split, no confirm.
 * - `'parent-child'` — the variant is not a taxonomy-bearing object at all
 *   (a WooCommerce product variation has no `categories` field); category is
 *   structurally parent-only.
 */
export const VariantGroupingModelValues = [
  'catalog-implicit',
  'explicit-group',
  'parent-child',
] as const;

/** Derived union type from {@link VariantGroupingModelValues}. */
export type VariantGroupingModel = (typeof VariantGroupingModelValues)[number];

/**
 * Resolve the effective variant-grouping model for an adapter, defaulting to
 * the most restrictive shape (`'parent-child'`) when the adapter declares
 * nothing (#1924). The opposite default would let an undeclared destination
 * silently offer a per-variant category override its API cannot actually
 * carry — the operator would only discover that from a rejected publish.
 * Pure, no I/O.
 */
export function resolveVariantGroupingModel(
  metadata: Pick<AdapterMetadata, 'variantGrouping'> | undefined | null
): VariantGroupingModel {
  return metadata?.variantGrouping ?? 'parent-child';
}

/**
 * Resolve whether an adapter's connections must carry credentials, defaulting
 * to `true` when the adapter declares nothing (#2405, ADR-055). The safe
 * default is the restrictive one: an unresolvable or silent adapter keeps the
 * credential guard it has always had, so relaxing it is always an explicit act
 * by the adapter author.
 *
 * Pure, no I/O — the `resolveVariantGroupingModel` shape directly above, and
 * admissible in a `*.types.ts` under the same rule
 * (`docs/engineering-standards.md` § the pure-rule exception, #2231): it is
 * the coercion rule for the field it sits beside, and the two change together.
 */
export function resolveRequiresCredentials(
  metadata: Pick<AdapterMetadata, 'requiresCredentials'> | undefined | null
): boolean {
  return metadata?.requiresCredentials ?? true;
}

