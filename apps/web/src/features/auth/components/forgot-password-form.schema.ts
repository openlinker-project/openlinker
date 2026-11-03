import { z } from 'zod';
import type { AuthValidationCopy } from './login-form.schema';

export function createForgotPasswordFormSchema(copy: AuthValidationCopy) {
  return z.object({
    email: z.string().trim().email(copy.email),
  });
}

export type ForgotPasswordFormValues = z.input<ReturnType<typeof createForgotPasswordFormSchema>>;
