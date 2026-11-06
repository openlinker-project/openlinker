/**
 * Login Page Settings Repository Port
 *
 * Persistence contract for the singleton login-page copy row.
 *
 * @module libs/core/src/login-page-settings/domain/ports
 */
import type { LoginPageSettings } from '../entities/login-page-settings.entity';
import type { LoginPageCopyByLocale } from '../types/login-page-settings.types';

export interface LoginPageSettingsRepositoryPort {
  findSettings(): Promise<LoginPageSettings | null>;

  /** Replaces the stored copy as a whole; the service merges before calling. */
  saveCopy(copy: LoginPageCopyByLocale, updatedBy: string | null): Promise<LoginPageSettings>;
}
