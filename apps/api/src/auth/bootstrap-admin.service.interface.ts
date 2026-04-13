/**
 * Bootstrap Admin Service Interface
 *
 * Contract for the on-boot admin user seeder. Runs once at application
 * startup and is a no-op on subsequent boots.
 *
 * @module apps/api/src/auth
 */
export interface IBootstrapAdminService {
  bootstrap(): Promise<void>;
}
