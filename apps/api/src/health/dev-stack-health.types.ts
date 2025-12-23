/**
 * Dev Stack Health Types
 *
 * Type definitions for development stack health check responses.
 *
 * @module apps/api/src/health
 */
export type ServiceStatus = 'ok' | 'error';

export interface ServiceHealth {
  status: ServiceStatus;
  message?: string;
}

export interface InternalHealthResponse {
  status: 'ok' | 'error';
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
  };
  timestamp: string;
}

export interface DevStackHealthResponse {
  status: 'ok' | 'degraded' | 'error';
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
    prestashop: ServiceHealth;
  };
  timestamp: string;
}

