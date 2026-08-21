/**
 * Well-known platform types shipped in-tree. Mirrors `CORE_CAPABILITY_VALUES`
 * below — open at the boundary: plugin authors can register additional
 * platform types without modifying core (#578). Use `string` where the FE
 * consumes adapter-supplied values; use this constant only when an
 * exhaustive in-tree list is genuinely needed (e.g. fixture defaults).
 */
export const CORE_PLATFORM_TYPES = ['prestashop', 'allegro', 'woocommerce'] as const;

/**
 * Connection platform type — an opaque string. Plugins are resolved by
 * platform key via the FE plugin registry (`apps/web/src/plugins/`).
 * Do not literal-equality-dispatch on this value — use `usePlatform()` or
 * `supportedCapabilities` checks instead (enforced by ESLint).
 */
export type PlatformType = string;

export type ConnectionStatus = 'active' | 'disabled' | 'error' | 'needs_reauth';

/**
 * Well-known core capabilities — mirrors `CoreCapabilityValues` on the backend.
 * Plugin adapters can register additional capability names; FE accepts those
 * as plain strings without runtime narrowing failures (#576).
 */
export const CORE_CAPABILITY_VALUES = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'OfferManager',
  // Shop-listing (ADR-024): 'ProductPublisher' resolves a ShopProductManagerPort,
  // 'CategoryProvisioner' is its provision sub-capability.
  'ProductPublisher',
  'CategoryProvisioner',
  // Invoicing (ADR-026).
  'Invoicing',
  // Fiscalization (ADR-042) - registering a completed sale with a provider that
  // performs or brokers its fiscal registration. Distinct from 'Invoicing'.
  'Fiscalization',
] as const;

/**
 * Closed type for the well-known core capabilities. Use where exhaustiveness
 * matters (UI dropdowns, dispatch dialog gating). Use `string`
 * where the FE consumes adapter-supplied capability names.
 */
export type CoreCapability = (typeof CORE_CAPABILITY_VALUES)[number];

/**
 * How a destination groups sibling variants into one listing, and therefore
 * whether - and how consequentially - a single variant may carry its own
 * category. Mirrors `VariantGroupingModelValues` on the backend (#1924).
 */
export const VARIANT_GROUPING_MODEL_VALUES = [
  'catalog-implicit',
  'explicit-group',
  'parent-child',
] as const;

export type VariantGroupingModel = (typeof VARIANT_GROUPING_MODEL_VALUES)[number];

/**
 * Resolve the effective variant-grouping model for a connection, defaulting
 * to the most restrictive shape (`'parent-child'`) when absent — mirrors the
 * backend's `resolveVariantGroupingModel` (#1924). The API always sends a
 * resolved value; this keeps older/hand-rolled test fixtures that omit the
 * field working without a mass edit.
 */
export function resolveVariantGroupingModel(
  connection: Pick<Connection, 'variantGrouping'> | undefined | null
): VariantGroupingModel {
  return connection?.variantGrouping ?? 'parent-child';
}

/** Mirrors the backend's `ConnectionRateLimit` (`@openlinker/core/identifier-mapping`). */
export interface ConnectionRateLimit {
  requestsPerMinute?: number;
  maxConcurrent?: number;
}

export interface Connection {
  id: string;
  name: string;
  platformType: PlatformType;
  status: ConnectionStatus;
  config: Record<string, unknown>;
  /** True when credentials are stored in the database and can be rotated via PUT /credentials. */
  credentialsBacked: boolean;
  adapterKey?: string;
  enabledCapabilities: string[];
  supportedCapabilities: string[];
  /** Derived from the resolved adapter's manifest (#1924). Read via `resolveVariantGroupingModel`, not directly, so an absent value still resolves to the locked default. */
  variantGrouping?: VariantGroupingModel;
  /**
   * The resolved adapter's fallback outbound rate limit (#1810), rendered by
   * `RateLimitSection` to describe what applies while `config.rateLimit` is
   * empty — derived from the adapter manifest, never persisted. Absent/`null`
   * means the adapter declares none, so an empty `config.rateLimit` is truly
   * unlimited. The API always sends a resolved value (`null` when none);
   * optional here only to keep older/hand-rolled test fixtures that omit the
   * field working without a mass edit.
   */
  defaultRateLimit?: ConnectionRateLimit | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionFilters {
  platformType?: PlatformType;
  status?: ConnectionStatus;
}

export interface CreateConnectionInput {
  name: string;
  platformType: PlatformType;
  config: Record<string, unknown>;
  /** Platform-specific credential payload (e.g. `{ webserviceApiKey }` for PrestaShop). */
  credentials?: Record<string, unknown>;
  /** Existing db-backed reference (must start with `db:`). Used by OAuth flows. */
  credentialsRef?: string;
  adapterKey?: string;
  /**
   * Capabilities to enable on this connection. Strict on the well-known core
   * set today — mirrors the BE request DTO contract. Plugin-registered
   * capabilities are out of scope for the create/update path until the
   * runtime-aware DTO validator follow-up lands (#576).
   */
  enabledCapabilities?: CoreCapability[];
}

export interface UpdateConnectionInput {
  name?: string;
  status?: ConnectionStatus;
  config?: Record<string, unknown>;
  adapterKey?: string;
  enabledCapabilities?: CoreCapability[];
}

export interface RecentJobSummary {
  id: string;
  jobType: string;
  status: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

export interface ConnectionTestResult {
  success: boolean;
  status?: number;
  message: string;
  latencyMs: number;
}

/**
 * Entry from `GET /connections/:id/bank-accounts` (#1303 follow-up). Only
 * meaningful for connections whose Invoicing adapter implements
 * BankAccountsReader (today: Infakt).
 */
export interface BankAccount {
  id: string;
  accountNumber: string;
  bankName: string;
  isDefault: boolean;
}

/**
 * Owner-aware bank account from the Subiekt-specific route
 * `GET /integrations/subiekt/connections/:id/bank-accounts` (#1324). Distinct
 * from the neutral {@link BankAccount} served by the capability-generic
 * InvoicingController: it carries `ownerPodmiotId`/`ownerName` so the Subiekt
 * FE can group accounts by payer and show the payer-routing warning only when
 * more than one seller Podmiot is present. Kept Subiekt-local (no core
 * capability) because no other provider has a multi-payer concept.
 */
export interface SubiektBankAccount {
  id: string;
  accountNumber: string;
  bankName: string;
  isDefault: boolean;
  ownerPodmiotId: number;
  ownerName: string | null;
}

/**
 * Cash register (Stanowisko Kasowe) from
 * `GET /integrations/subiekt/connections/:id/cash-registers` (#1324). A real,
 * working per-document selector. `oddzialId` is an informational branch tag
 * only — the Oddział axis itself is NOT selectable (it is bound read-only to
 * the bridge's logged-in Sfera session; see issue #1324 Part B / decision 8b).
 */
export interface SubiektCashRegister {
  id: number;
  name: string | null;
  symbol: string | null;
  oddzialId: number | null;
}

/**
 * Response from `POST /connections/:id/webhooks/install` (#168). Reports whether
 * the WS push and the synchronous test ping both completed.
 */
export interface InstallWebhooksResult {
  webhooksConfigured: boolean;
  testPingTriggered: boolean;
  /** Operator-actionable warning attached to partial-success states. */
  warning?: string;
}

/**
 * Response from `POST /connections/:id/webhooks/secret/rotate`. The plaintext
 * secret is revealed exactly once here and is never retrievable again — callers
 * must surface it immediately for the operator to store.
 */
export interface RotateWebhookSecretResult {
  secret: string;
  revealedOnce: boolean;
  warning: string;
}

/**
 * Operator-facing webhook state for a connection (`GET
 * /connections/:id/webhooks/status`, #1770). `activation` is inferred from
 * delivery + rejection history (`auth-failing` = deliveries arriving but every
 * one rejected at signature check, #1814); `signature` reflects whether HMAC
 * verification is configured (optional). Backs the inFakt webhook-config modal.
 */
export type WebhookActivation = 'not-registered' | 'verified' | 'auth-failing';
export type WebhookSignatureState = 'off' | 'configured';

export interface WebhookStatus {
  activation: WebhookActivation;
  signature: WebhookSignatureState;
  lastDeliveryAt: string | null;
  lastDeliveryEvent: string | null;
  lastDeliveryResult: string | null;
}

/**
 * Where a resolve ceiling came from (#2229). Mirrors
 * `ResolveConcurrencySourceValues` in `@openlinker/core/listings`.
 */
export type ResolveConcurrencySource = 'connection-config' | 'adapter-default';

/**
 * In-flight ceiling the connection's category-resolve path enforces (#2229),
 * declared by its own adapter. `adapterDefault` is what would apply with no
 * operator cap, so a clamped `maxInFlight` can name what clamped it.
 */
export interface ResolveConcurrencyCeiling {
  maxInFlight: number;
  source: ResolveConcurrencySource;
  adapterDefault: number;
}

/**
 * Live, in-memory outbound rate-limit status for ANY connection
 * (`GET /connections/:id/rate-limit-status`, #1810).
 *
 * `enabled` describes the SHARED OUTBOUND LIMITER only — `false` means neither
 * an explicit `config.rateLimit` nor the destination adapter's manifest
 * default applies, and the counters below are absent. It does NOT mean
 * nothing paces this connection: `resolveConcurrency` (#2229) reports a
 * ceiling applied below the limiter, inside the adapter's own resolver, and is
 * independent of `enabled`. Rendering `enabled: false` as "not rate-limited"
 * is the false claim #2229 exists to remove — say which mechanism is off.
 *
 * Resets on API/worker restart; not a persisted audit trail.
 */
export interface RateLimitStatus {
  enabled: boolean;
  requestsPerMinute?: number;
  maxConcurrent?: number;
  inFlight?: number;
  queued?: number;
  lastAcquiredAt?: string | null;
  /** Absent when no adapter reported one — never render a fabricated value. */
  resolveConcurrency?: ResolveConcurrencyCeiling;
}

export interface ConnectionDiagnostics {
  connectionId: string;
  connectionName: string;
  connectionStatus: string;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  recentErrors: string[];
  recentJobs: RecentJobSummary[];
}
