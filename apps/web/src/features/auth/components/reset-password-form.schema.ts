import { z } from 'zod';
import { interpolate } from '../../../shared/i18n';
import type { AuthValidationCopy } from './auth-form.types';

const PASSWORD_MIN_LENGTH = 8;

export function createResetPasswordFormSchema(copy: AuthValidationCopy) {
  return z
    .object({
      newPassword: z
        .string()
        .min(PASSWORD_MIN_LENGTH, interpolate(copy.passwordMin, { min: PASSWORD_MIN_LENGTH })),
      confirmPassword: z.string().min(1, copy.confirmNewPassword),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      path: ['confirmPassword'],
      message: copy.passwordsDiffer,
    });
}

export type ResetPasswordFormValues = z.input<ReturnType<typeof createResetPasswordFormSchema>>;
