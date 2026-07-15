/**
 * Dev Stack Health Types
 *
 * Type definitions for development stack health check responses.
 *
 * @module apps/api/src/health
 */
export type ServiceStatus = 'ok' | 'warning' | 'error';

export interface ServiceHealth {
  status: ServiceStatus;
  message?: string;
}

export interface InternalHealthResponse {
  status: 'ok' | 'error';
  /** Product (release) version of the running process (#1133). */
  version: string;
  /** HTTP API version label, e.g. `v1` (#1133). */
  api: string;
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
  };
  timestamp: string;
}

/**
 * Readiness half of the internal health response — the DB/Redis probe result
 * the health service owns. The root controller overlays the version surface
 * (`version` + `api`, #1133) onto this to build the full `InternalHealthResponse`.
 */
export type InternalHealthReadiness = Omit<InternalHealthResponse, 'version' | 'api'>;

/**
 * Health entry for a single infrastructure-bearing connection (#1619).
 *
 * A connection is infrastructure-bearing when its adapter's capabilities
 * indicate it backs a real shop/warehouse system (`ProductMaster` and/or
 * `InventoryMaster`) rather than being a marketplace listing channel. Today
 * this surfaces WooCommerce; it generalizes to any future adapter with the
 * same capability shape without further changes here.
 */
export interface ConnectionHealthEntry {
  connectionId: string;
  name: string;
  platformType: string;
  status: ServiceStatus;
  message?: string;
}

export interface DevStackHealthResponse {
  status: 'ok' | 'degraded' | 'error';
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
    prestashop: ServiceHealth;
    worker: ServiceHealth;
  };
  /**
   * Infra-bearing connections (e.g. a connected WooCommerce shop) discovered
   * at request time and probed via their `ConnectionTesterPort` adapter.
   * Empty when no such connections are configured.
   */
  connections: ConnectionHealthEntry[];
  timestamp: string;
}
