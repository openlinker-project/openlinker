import { z } from 'zod';

// 8..72 mirrors the backend `ChangePasswordDto` (bcrypt reads at most 72 bytes).
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter the one-time password you were given'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the one-time password',
  });

export type ChangePasswordFormValues = z.input<typeof changePasswordFormSchema>;
