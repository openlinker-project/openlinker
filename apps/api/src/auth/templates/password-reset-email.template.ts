/**
 * Password Reset Email HTML Template
 *
 * Renders the branded HTML body for the password-reset message on the
 * shared theme-aware layout (#1748). The plaintext part stays with the
 * notifier adapter as the multipart alternative. Kept in `apps/api`
 * (not `libs/core`) - rendering detail of one mailer call, not a
 * domain concern.
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

export interface PasswordResetEmailTemplateInput {
  username: string;
  link: string;
  ttlMinutes: number;
}

const L = EMAIL_COLORS.light;

export function renderPasswordResetEmailHtml({
  username,
  link,
  ttlMinutes,
}: PasswordResetEmailTemplateInput): string {
  const safeUsername = escapeHtml(username);
  const safeLink = escapeHtml(link);

  const contentHtml = `<p class="em-slate" style="margin:0 0 14px 0; font-size:14px; line-height:1.6; color:${L.slate};">
                  Hello <strong class="em-ink" style="color:${L.ink}; font-weight:600;">${safeUsername}</strong>, we received a request to reset the password for your OpenLinker account.
                </p>
                ${renderCtaButton('Choose a new password', safeLink)}
                ${renderFallbackLinkWell(safeLink)}`;

  const metaHtml = `<p class="em-mist" style="margin:0 0 6px 0; font-size:12px; line-height:1.6; color:${L.mist};">This link expires in ${ttlMinutes} minutes and can be used once.</p>
                      <p class="em-mist" style="margin:0; font-size:12px; line-height:1.6; color:${L.mist};">If you did not request a reset, ignore this email - your password stays unchanged.</p>`;

  return renderEmailLayout({
    title: 'Reset your password',
    eyebrow: 'Security',
    contentHtml,
    metaHtml,
  });
}
