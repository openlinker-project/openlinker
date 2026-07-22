import { z } from 'zod';

export const registerFormSchema = z
  .object({
    username: z.string().min(1, 'Username is required'),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    // Opt-in (#1743): the checkbox ships unchecked; ticking it opts in.
    analyticsConsent: z.boolean(),
  })
  .superRefine(({ password, confirmPassword }, ctx) => {
    if (confirmPassword && password !== confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match',
        path: ['confirmPassword'],
      });
    }
  });

export type RegisterFormValues = z.input<typeof registerFormSchema>;
export type RegisterFormSubmission = z.output<typeof registerFormSchema>;
