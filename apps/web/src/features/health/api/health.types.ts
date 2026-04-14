export type ServiceStatus = 'ok' | 'warning' | 'error';
export type OverallStatus = 'ok' | 'degraded' | 'error';

export interface ServiceHealth {
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
  timestamp: string;
}
