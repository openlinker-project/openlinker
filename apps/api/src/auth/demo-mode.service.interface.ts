/**
 * Demo Mode Service Interface
 *
 * Contract for the demo mode service that checks whether the deployment is
 * running in demo mode (OL_DEMO_MODE=true). Consumed by RegistrationService
 * to auto-approve demo registrations, and exposed to the system config endpoint.
 *
 * @module apps/api/src/auth
 */

export interface IDemoModeService {
  isDemoModeEnabled(): boolean;
}

export const DEMO_MODE_SERVICE_TOKEN = Symbol('IDemoModeService');
