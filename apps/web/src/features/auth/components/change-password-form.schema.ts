import { z } from 'zod';
import { interpolate } from '../../../shared/i18n';
import type { AuthValidationCopy } from './auth-form.types';

// 8..72 mirrors the backend `ChangePasswordDto` (bcrypt reads at most 72 bytes).
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

export function createChangePasswordFormSchema(copy: AuthValidationCopy) {
  return z
    .object({
      currentPassword: z.string().min(1, copy.oneTimePassword),
      newPassword: z
        .string()
        .min(PASSWORD_MIN_LENGTH, interpolate(copy.passwordMin, { min: PASSWORD_MIN_LENGTH }))
        .max(PASSWORD_MAX_LENGTH, interpolate(copy.passwordMax, { max: PASSWORD_MAX_LENGTH })),
      confirmPassword: z.string().min(1, copy.confirmNewPassword),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      path: ['confirmPassword'],
      message: copy.passwordsDiffer,
    })
    .refine((v) => v.newPassword !== v.currentPassword, {
      path: ['newPassword'],
      message: copy.passwordReused,
    });
}

export type ChangePasswordFormValues = z.input<ReturnType<typeof createChangePasswordFormSchema>>;
