/**
 * Add-a-packer form schema (#3457, step 2)
 *
 * Mirrors `CreateUserDto`'s rules so a value the API would refuse is caught
 * before the request: a name and a login are required, the login may not
 * contain "@" (sign-in routes on that character), and the email is optional —
 * an empty field means "no email", not an invalid one.
 *
 * @module features/oms-onboarding/components
 */
import { z } from 'zod';

import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';

export const addPackerFormSchema = z.object({
  displayName: z.string().trim().min(1, COPY.step2.nameRequired).max(120),
  username: z
    .string()
    .trim()
    .min(1, COPY.step2.loginRequired)
    .max(100)
    .refine((value) => !value.includes('@'), COPY.step2.loginNoAt),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || z.string().email().safeParse(value).success, COPY.step2.emailInvalid),
});

export type AddPackerFormValues = z.input<typeof addPackerFormSchema>;
export type AddPackerFormSubmission = z.output<typeof addPackerFormSchema>;

export const ADD_PACKER_DEFAULTS: AddPackerFormValues = { displayName: '', username: '', email: '' };
