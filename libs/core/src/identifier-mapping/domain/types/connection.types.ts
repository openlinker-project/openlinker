/**
 * Connection Types
 *
 * Type definitions for Connection entity. Defines platform types, connection
 * status values, connection configuration structure, and CRUD operation types.
 * Used across the identifier mapping domain to represent integration instances.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { PricingRule } from './pricing-rule.types';

/**
 * Platform type identifier (e.g., 'prestashop', 'allegro', 'shopify')
 */
export type PlatformType = string;

/**
 * Connection status values
 *
 * Runtime array of all valid connection status values. Used for validation,
 * Swagger documentation, and UI dropdowns. Follows OpenLinker engineering
 * standards: `as const` + derived union type pattern.
 *
 * `needs_reauth` is set automatically when a job dies from a terminal
 * credential rejection (e.g. Allegro `invalid_grant` on token refresh, #819).
 * It is distinct from `error` (which covers other failure modes) so the UI can
 * surface a precise "re-authentication required" affordance, and — like every
 * non-`active` status — the scheduler's `status: 'active'` filter stops
 * enqueuing jobs against it. A successful re-auth flips it back to `active`.
 */
export const ConnectionStatusValues = ['active', 'disabled', 'error', 'needs_reauth'] as const;

/**
 * Connection status type
 *
 * Derived union type from ConnectionStatusValues. Provides type safety
 * without runtime overhead.
 */
export type ConnectionStatus = (typeof ConnectionStatusValues)[number];

/**
 * Connection configuration
 *
 * Platform-specific configuration stored as JSONB. Contains platform-specific
 * settings such as baseUrl, shopId, accountId, etc. Secrets should not be
 * stored here; use credentialsRef instead.
 */
export interface ConnectionConfig {
  /**
   * Invoicing trigger configuration (OL #1120). Non-breaking documentation
   * shape over the open index signature — the value is round-tripped verbatim
   * by `ConnectionRepository`. `triggerModel` is read at transition time by
   * `AutoIssueTriggerService` and coerced via `parseTriggerModel` (a missing or
   * unrecognized value defaults to `manual`). Typed as `string` here to keep the
   * identifier-mapping context decoupled from the invoicing enum.
   *
   * `shippingLineName` (#1562) is the optional, operator-supplied label the
   * issuance path threads into the neutral order→command mapper's shipping line
   * (`toIssueInvoiceCommand`). Country-agnostic by construction (ADR-026): core
   * stores an opaque string, so an operator localizes the buyer-visible label
   * (e.g. "Koszt wysyłki") without core hardcoding a language or switching on
   * `platformType`. A missing/blank value falls back to the mapper's neutral
   * `SHIPPING_LINE_NAME` default.
   */
  invoicing?: {
    triggerModel?: string;
    shippingLineName?: string;
    /**
     * Marks THIS connection as the one that auto-issues an order's invoice
     * (#2047). One sale is one invoice, so when several connections have
     * `Invoicing` enabled the auto-issue trigger honours exactly the primary and
     * issues NOTHING when the primary is ambiguous (unset, or set on more than
     * one). Read via `parseIsPrimaryInvoicing`; a missing value is `false`, which
     * keeps a single-connection install behaving exactly as before.
     */
    isPrimary?: boolean;
  };
  /**
   * Per-connection stock safety buffer (#1844). Units of master stock held back
   * as a reserve when publishing an offer / shop product or writing stock back to
   * this destination: the published quantity is `max(0, masterStock - reserve)`.
   * A missing/zero value preserves the pre-#1844 pass-through behaviour. Read via
   * `readStockSafetyBuffer` and applied via `applyStockSafetyBuffer`
   * (`stock-safety-buffer.types.ts`).
   */
  stockSafetyBuffer?: number;
  /**
   * Per-connection pricing-resolution rule (#1843). Markup/margin formula +
   * rounding applied when a destination's price is derived from the master
   * catalog price (no explicit per-item price override). A missing value
   * preserves the pre-#1843 raw passthrough. Read via `readPricingRule` and
   * applied via `applyPricingRule` (`pricing-rule.types.ts`).
   */
  pricingRule?: PricingRule;
  /**
   * Per-connection outbound rate limit (#1810). Applied via
   * `HostServices.http` (`HttpTransportFactoryPort.forConnection(connection)`) —
   * every plugin HTTP client's outbound calls are paced/capped through it
   * automatically, never read directly by plugin code. A missing value
   * means unlimited, byte-identical to pre-#1810 behaviour.
   * `requestsPerMinute` is minimum-interval spacing (capacity ~1, not a
   * bursty bucket); `maxConcurrent` is a concurrency semaphore. Both
   * knobs are optional and independent. Validated once, core-owned, in
   * `ConnectionService.create`/`.update` — never defaulted into stored
   * config (an adapter's `AdapterMetadata.defaultRateLimit` supplies the
   * resolution-time fallback for a connection with no explicit value — see
   * that field's own doc comment in `adapter.types.ts` for the call-site
   * wiring).
   *
   * **Scope: one bucket per connection, never per host** — the value means
   * "this connection's total outbound rate" no matter how many physical hosts
   * or processes (`apps/api`, `apps/worker`, any replica of either) act on
   * its behalf — the registry is Redis-backed and shared across all of them
   * (#2015), so the configured number is already the true aggregate; nothing
   * divides it further. See ADR-038 § "The cap is per connection" for why
   * hostname is not a quota axis.
   */
  rateLimit?: ConnectionRateLimit;
  /**
   * Sales-document routing configuration (#2155, ADR-041 decision 4). Which
   * originating fiscal document kind THIS connection issues — e.g.
   * `'invoice'` or `'fiscal-receipt'` (open-world, see
   * `@openlinker/core/sales-documents`' `SalesDocumentKind`). A missing value
   * means this connection is not a sales-document routing candidate at all.
   * Read via `readSalesDocumentRouting`, which also reads the SAME
   * `invoicing.isPrimary` flag above — decision 4 fixes that shape rather
   * than introducing a second `isPrimary` key here.
   */
  salesDocument?: {
    documentKind?: string;
  };
  [key: string]: unknown;
}

/**
 * Per-connection outbound rate limit (#1810). Mirrored (not imported) by
 * `@openlinker/shared/rate-limit`'s `ConnectionRateLimit` — that package
 * has zero dependency on any CORE domain type, so the two shapes are kept
 * structurally identical rather than unified via an import.
 */
export interface ConnectionRateLimit {
  /** Smooth-paced cap (minimum-interval spacing). Undefined = unlimited. */
  requestsPerMinute?: number;
  /** Max simultaneous in-flight requests. Undefined = unlimited. */
  maxConcurrent?: number;
}

/**
 * Connection creation payload
 *
 * Used when creating a new connection. All fields except adapterKey are required.
 * If adapterKey is not provided, it will be derived from platformType in the
 * IntegrationsService.
 */
export interface ConnectionCreate {
  name: string;
  platformType: PlatformType;
  config: ConnectionConfig;
  credentialsRef: string;
  adapterKey?: string;
  /**
   * Capabilities this connection should fulfil. Subset of the resolved adapter's
   * supportedCapabilities. When omitted at create time, ConnectionService defaults
   * this to the adapter's full supported set (behavior-preserving).
   */
  enabledCapabilities?: string[];
}

/**
 * Connection update payload
 *
 * Partial update payload for modifying an existing connection. Only provided
 * fields will be updated.
 */
export interface ConnectionUpdate {
  name?: string;
  status?: ConnectionStatus;
  config?: ConnectionConfig;
  /**
   * `adapterKey` is immutable post-create. Passing a value different from the
   * persisted one must cause ConnectionService.update to throw. Kept optional
   * here so existing callers that pass the unchanged value still type-check.
   */
  adapterKey?: string;
  enabledCapabilities?: string[];
}

/**
 * Connection filter criteria
 *
 * Used for filtering connections when listing. All fields are optional.
 */
export interface ConnectionFilters {
  platformType?: PlatformType;
  status?: ConnectionStatus;
}



