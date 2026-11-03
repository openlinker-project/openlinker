import { z } from 'zod';
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

/** The `auth.validation` copy, in the language the form renders in. */
export type AuthValidationCopy = ResolvedCopy<Messages['auth']>['validation'];

/**
 * A factory rather than a module-level schema: the messages are read when the
 * form builds its resolver, so they follow the active language.
 */
export function createLoginFormSchema(copy: AuthValidationCopy) {
  return z.object({
    username: z.string().trim().min(1, copy.username),
    password: z.string().min(1, copy.passwordRequired),
  });
}

export type LoginFormValues = z.input<ReturnType<typeof createLoginFormSchema>>;
