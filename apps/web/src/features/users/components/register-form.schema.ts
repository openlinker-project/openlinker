import { z } from 'zod';

/**
 * Shared by the schema and the form (#1938). The form renders it the moment the
 * box is unticked rather than waiting for a rejected submit, so the visitor
 * learns about the requirement where the decision is made.
 */
export const ANALYTICS_CONSENT_REQUIRED_MESSAGE =
  'Demo accounts need session recording. Turn it back on to continue.';

export const registerFormSchema = z
  .object({
    username: z.string().min(1, 'Username is required'),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    // Stays a boolean so the checkbox can hold either state; the refinement
    // below is what makes `false` invalid (#1938). `z.literal(true)` would
    // narrow the form's own value type to `true` and leave the control unable
    // to represent being unticked.
    analyticsConsent: z.boolean(),
  })
  .superRefine(({ password, confirmPassword, analyticsConsent }, ctx) => {
    if (confirmPassword && password !== confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match',
        path: ['confirmPassword'],
      });
    }
    // Session recording is a condition of holding a demo account (#1938), so
    // an unticked box is a validation failure rather than an opt-out. The
    // backend rejects a consent-less registration as well.
    if (analyticsConsent !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: ANALYTICS_CONSENT_REQUIRED_MESSAGE,
        path: ['analyticsConsent'],
      });
    }
  });

export type RegisterFormValues = z.input<typeof registerFormSchema>;
export type RegisterFormSubmission = z.output<typeof registerFormSchema>;
