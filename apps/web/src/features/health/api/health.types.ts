export type ServiceStatus = 'ok' | 'warning' | 'error';
export type OverallStatus = 'ok' | 'degraded' | 'error';

export interface ServiceHealth {
  status: ServiceStatus;
  message?: string;
}

/**
 * Health entry for a single infrastructure-bearing connection (#1619) - a
 * connection whose adapter backs a real shop/warehouse system (e.g. a
 * connected WooCommerce shop) rather than a marketplace listing channel.
 *
 * `name` and `message` are optional because the backend only includes them
 * for an authenticated request - an anonymous caller of the (still public)
 * `/health/dev-stack` endpoint gets the generic status-only shape. The
 * dashboard is behind login, so in practice this widget always sees them,
 * but the type has to reflect what the wire contract actually allows.
 */
export interface ConnectionHealthEntry {
  connectionId: string;
  name?: string;
  platformType: string;
  status: ServiceStatus;
  message?: string;
}

export interface DevStackHealth {
  status: OverallStatus;
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
    prestashop: ServiceHealth;
    worker?: ServiceHealth;
  };
  /**
   * Infra-bearing connections (e.g. a connected WooCommerce shop) discovered
   * and probed alongside the fixed core services. Empty when none exist.
   * Optional for backward compatibility with cached/older responses.
   */
  connections?: ConnectionHealthEntry[];
  timestamp: string;
}
