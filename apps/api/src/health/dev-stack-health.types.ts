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

export interface DevStackHealthResponse {
  status: 'ok' | 'degraded' | 'error';
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
    prestashop: ServiceHealth;
    worker: ServiceHealth;
  };
  timestamp: string;
}

