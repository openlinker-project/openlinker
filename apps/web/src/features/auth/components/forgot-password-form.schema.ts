import { z } from 'zod';

export const forgotPasswordFormSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});

export type ForgotPasswordFormValues = z.input<typeof forgotPasswordFormSchema>;
