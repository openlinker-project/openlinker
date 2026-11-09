/**
 * Auth Card Schema
 *
 * One form backs both tabs, so a username or password typed on one tab is
 * still there on the other (#4029). Messages are KEYS into `login.ui.v`, not
 * sentences: the card renders them in the active language, so switching the
 * language re-renders an error that is already on screen.
 *
 * @module features/auth/components/login-stage
 */
import { z } from 'zod';

export type AuthErrorKey =
  | 'usernameLogin'
  | 'usernameRegister'
  | 'email'
  | 'emailBad'
  | 'password'
  | 'password8'
  | 'confirm'
  | 'mismatch'
  | 'taken';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export const loginStageSchema = z.object({
  username: z.string().refine((v) => v.trim().length > 0, 'usernameLogin'),
  email: z.string(),
  password: z.string().min(1, 'password'),
  confirm: z.string(),
});

export const registerStageSchema = z
  .object({
    username: z.string().refine((v) => v.trim().length > 0, 'usernameRegister'),
    email: z
      .string()
      .refine((v) => v.trim().length > 0, 'email')
      .refine((v) => v.trim().length === 0 || EMAIL_PATTERN.test(v), 'emailBad'),
    password: z
      .string()
      .min(1, 'password')
      .refine((v) => v.length === 0 || v.length >= 8, 'password8'),
    confirm: z.string(),
  })
  .superRefine(({ password, confirm }, ctx) => {
    if (confirm !== password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirm'],
        message: confirm ? 'mismatch' : 'confirm',
      });
    }
  });

export type AuthStageFormValues = z.input<typeof loginStageSchema>;
export type AuthStageFormSubmission = z.output<typeof loginStageSchema>;
