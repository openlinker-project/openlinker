/**
 * Users form types
 *
 * The validation copy the users form schemas are built with.
 *
 * @module features/users/components
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

/** The `users.validation` copy, in the language the form renders in. */
export type UsersValidationCopy = ResolvedCopy<Messages['users']>['validation'];
