/**
 * Confirmation Email HTML Template
 *
 * Renders the branded HTML body for the email-confirmation message
 * (#1650), composed on the shared theme-aware layout (#1748). Kept in
 * `apps/api` (not `libs/core`) - this is a rendering detail of one mailer
 * call, not a domain concern.
 *
 * @module apps/api/src/auth/templates
 * @see {@link renderEmailLayout} for the shared shell and palette
 */
import {
  EMAIL_COLORS,
  escapeHtml,
  renderCtaButton,
  renderEmailLayout,
  renderFallbackLinkWell,
} from './email-layout.template';

export interface ConfirmationEmailTemplateInput {
  username: string;
  link: string;
  ttlHours: number;
}

const L = EMAIL_COLORS.light;

export function renderConfirmationEmailHtml({
  username,
  link,
  ttlHours,
}: ConfirmationEmailTemplateInput): string {
  const safeUsername = escapeHtml(username);
  const safeLink = escapeHtml(link);

  const contentHtml = `<p class="em-slate" style="margin:0 0 14px 0; font-size:14px; line-height:1.6; color:${L.slate};">
                  Hello <strong class="em-ink" style="color:${L.ink}; font-weight:600;">${safeUsername}</strong>, thanks for signing up for OpenLinker. Confirm your email address to activate your account.
                </p>
                ${renderCtaButton('Confirm your email', safeLink)}
                ${renderFallbackLinkWell(safeLink)}`;

  const metaHtml = `<p class="em-mist" style="margin:0 0 6px 0; font-size:12px; line-height:1.6; color:${L.mist};">This link expires in ${ttlHours} hours.</p>
                      <p class="em-mist" style="margin:0; font-size:12px; line-height:1.6; color:${L.mist};">If you did not create this account, you can safely ignore this email.</p>`;

  return renderEmailLayout({
    title: 'Confirm your email address',
    eyebrow: 'Account',
    contentHtml,
    metaHtml,
  });
}
