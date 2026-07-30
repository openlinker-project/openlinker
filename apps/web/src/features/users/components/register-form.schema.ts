import { z } from 'zod';

export const registerFormSchema = z
  .object({
    username: z.string().min(1, 'Username is required'),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    // No consent field (#1938): session recording is a condition of the free
    // demo, disclosed at registration and accepted by creating the account —
    // not a choice the visitor makes on this form. The submit handler derives
    // the acceptance flag from demo mode instead.
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
