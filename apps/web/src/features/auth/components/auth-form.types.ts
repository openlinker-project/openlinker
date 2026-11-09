/**
 * Auth form types
 *
 * The validation copy every auth form schema is built with, in one place so
 * the login, change-password, forgot-password and reset-password schemas do
 * not depend on one another.
 *
 * @module features/auth/components
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

/** The `auth.validation` copy, in the language the form renders in. */
export type AuthValidationCopy = ResolvedCopy<Messages['auth']>['validation'];
