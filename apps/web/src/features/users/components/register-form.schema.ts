import { z } from 'zod';
import { interpolate } from '../../../shared/i18n';
import type { UsersValidationCopy } from './users-form.types';

const PASSWORD_MIN_LENGTH = 8;

/**
 * A factory rather than a module-level schema: the messages are read when the
 * form builds its resolver, so they follow the active language.
 */
export function createRegisterFormSchema(copy: UsersValidationCopy) {
  return z
    .object({
      username: z.string().min(1, copy.username),
      email: z.string().email(copy.email),
      password: z
        .string()
        .min(PASSWORD_MIN_LENGTH, interpolate(copy.passwordMin, { min: PASSWORD_MIN_LENGTH })),
      confirmPassword: z.string().min(1, copy.confirmPassword),
    })
    .superRefine(({ password, confirmPassword }, ctx) => {
      if (confirmPassword && password !== confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: copy.passwordsDiffer,
          path: ['confirmPassword'],
        });
      }
    });
}

export type RegisterFormValues = z.input<ReturnType<typeof createRegisterFormSchema>>;
export type RegisterFormSubmission = z.output<ReturnType<typeof createRegisterFormSchema>>;
