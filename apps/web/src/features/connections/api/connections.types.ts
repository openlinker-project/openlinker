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
] as const;

/**
 * Closed type for the well-known core capabilities. Use where exhaustiveness
 * matters (UI dropdowns, dispatch dialog gating). Use `string`
 * where the FE consumes adapter-supplied capability names.
 */
export type CoreCapability = (typeof CORE_CAPABILITY_VALUES)[number];

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
 * Response from `POST /connections/:id/webhooks/install` (#168). Reports whether
 * the WS push and the synchronous test ping both completed.
 */
export interface InstallWebhooksResult {
  webhooksConfigured: boolean;
  testPingTriggered: boolean;
  /** Operator-actionable warning attached to partial-success states. */
  warning?: string;
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
