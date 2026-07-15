/**
 * Mailer Settings Form — Zod Schema
 *
 * Port/host/from-address are represented as plain strings in the form (the
 * port field is a text input so an empty value can be distinguished from
 * `0`) and only required when `transport === 'smtp'` — mirrors the backend
 * DTO comment ("the controller does not cross-validate this... trusting the
 * admin form"), so this is exactly where that validation belongs. The
 * password field is always optional: leaving it blank keeps whatever is
 * already stored server-side (write-only, never pre-filled).
 *
 * @module apps/web/src/features/mailer-settings/components
 */
import { z } from 'zod';
import { MailerTransportValues } from '../api/mailer-settings.types';

export const MAX_HOST_LENGTH = 255;
export const MAX_FROM_ADDRESS_LENGTH = 320;
export const MAX_PASSWORD_LENGTH = 512;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const mailerSettingsFormSchema = z
  .object({
    transport: z.enum(MailerTransportValues),
    smtpHost: z.string().trim().max(MAX_HOST_LENGTH, `Host is too long (max ${MAX_HOST_LENGTH} characters)`),
    smtpPort: z.string().trim(),
    smtpSecure: z.boolean(),
    fromAddress: z
      .string()
      .trim()
      .max(MAX_FROM_ADDRESS_LENGTH, `From address is too long (max ${MAX_FROM_ADDRESS_LENGTH} characters)`),
    password: z
      .string()
      .trim()
      .max(MAX_PASSWORD_LENGTH, `Password is too long (max ${MAX_PASSWORD_LENGTH} characters)`),
  })
  .superRefine((values, ctx) => {
    if (values.transport !== 'smtp') {
      return;
    }

    if (values.smtpHost.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['smtpHost'],
        message: 'Host is required for SMTP transport',
      });
    }

    if (values.smtpPort.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['smtpPort'],
        message: 'Port is required for SMTP transport',
      });
    } else {
      const port = Number(values.smtpPort);
      if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['smtpPort'],
          message: `Port must be an integer between ${MIN_PORT} and ${MAX_PORT}`,
        });
      }
    }

    if (values.fromAddress.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fromAddress'],
        message: 'From address is required for SMTP transport',
      });
    } else if (!EMAIL_PATTERN.test(values.fromAddress)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fromAddress'],
        message: 'Enter a valid email address',
      });
    }
  });

export type MailerSettingsFormValues = z.input<typeof mailerSettingsFormSchema>;
export type MailerSettingsFormSubmission = z.output<typeof mailerSettingsFormSchema>;
