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
import { interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { MailerTransportValues } from '../api/mailer-settings.types';

export const MAX_HOST_LENGTH = 255;
export const MAX_FROM_ADDRESS_LENGTH = 320;
export const MAX_PASSWORD_LENGTH = 512;
const MIN_PORT = 1;
const MAX_PORT = 65535;
// Excludes `<`/`>` (in addition to whitespace/`@`) so a stray bracket can't be
// swallowed into the local-part or domain — e.g. `,<test@test.test` inside a
// malformed `Test <,<test@test.test>` input would otherwise still satisfy this
// pattern once the outer `<...>` wrapper is stripped off. The leading
// `(?!.*\.\.)` lookahead rejects a consecutive `..` anywhere (e.g.
// `test..test@test.pl`), and the local-part/domain each require a non-dot
// first character so neither segment can start with a stray `.`.
const EMAIL_PATTERN = /^(?!.*\.\.)[^\s@<>.][^\s@<>]*@[^\s@<>.][^\s@<>]*\.[^\s@<>]+$/;
// Matches `Display Name <email@domain.com>` — nodemailer parses this form natively
// into the `From:` header, and the backend DTO has no `@IsEmail()` gate, so this
// client-side check only needs to confirm the bracketed part looks like an email.
// The name segment excludes `<`/`>` so a second bracketed address (e.g.
// `A <b@c.com> <d@e.com>`) fails the match instead of silently picking the last one.
// It also excludes CR/LF: unlike the bare-email path (where `\s` already blocks
// them), `[^<>]` alone would let a CRLF-carrying name through — the classic
// email-header-injection shape (`From:` value smuggling a second header).
const NAME_AND_EMAIL_PATTERN = /^[^<>\r\n]+\s<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>$/;

function isValidFromAddress(value: string): boolean {
  if (EMAIL_PATTERN.test(value)) {
    return true;
  }
  const match = NAME_AND_EMAIL_PATTERN.exec(value);
  return match !== null && EMAIL_PATTERN.test(match[1]);
}

export type MailerSettingsFormSchemaCopy = ResolvedCopy<
  Messages['mailer-settings']
>['mailerSettingsFormSchema'];

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the zod type is inferred from this builder
export function createMailerSettingsFormSchema(copy: MailerSettingsFormSchemaCopy) {
  return z
    .object({
      transport: z.enum(MailerTransportValues),
      smtpHost: z.string().trim().max(MAX_HOST_LENGTH, interpolate(copy.hostTooLong, { max: MAX_HOST_LENGTH })),
      smtpPort: z.string().trim(),
      smtpSecure: z.boolean(),
      fromAddress: z
        .string()
        .trim()
        .max(MAX_FROM_ADDRESS_LENGTH, interpolate(copy.fromTooLong, { max: MAX_FROM_ADDRESS_LENGTH })),
      password: z
        .string()
        .trim()
        .max(MAX_PASSWORD_LENGTH, interpolate(copy.passwordTooLong, { max: MAX_PASSWORD_LENGTH })),
    })
    .superRefine((values, ctx) => {
      if (values.transport !== 'smtp') {
        return;
      }

      if (values.smtpHost.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['smtpHost'],
          message: copy.hostRequired,
        });
      }

      if (values.smtpPort.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['smtpPort'],
          message: copy.portRequired,
        });
      } else {
        const port = Number(values.smtpPort);
        if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['smtpPort'],
            message: interpolate(copy.portRange, { min: MIN_PORT, max: MAX_PORT }),
          });
        }
      }

      if (values.fromAddress.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fromAddress'],
          message: copy.fromRequired,
        });
      } else if (!isValidFromAddress(values.fromAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fromAddress'],
          message: copy.fromInvalid,
        });
      }
    });
}

type MailerSettingsFormSchema = ReturnType<typeof createMailerSettingsFormSchema>;
export type MailerSettingsFormValues = z.input<MailerSettingsFormSchema>;
export type MailerSettingsFormSubmission = z.output<MailerSettingsFormSchema>;
