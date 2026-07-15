/**
 * Confirmation Email HTML Template
 *
 * Renders the branded HTML body for the email-confirmation message
 * (#1650). Deliberately separate from the app's design-tokens-based web
 * CSS system: email clients don't load external stylesheets or support
 * most modern CSS, so every rule here is inlined on the element it
 * affects, and the layout uses table-friendly, widely-supported
 * properties only. Kept in `apps/api` (not `libs/core`) — this is a
 * rendering detail of one mailer call, not a domain concern.
 *
 * @module apps/api/src/auth/templates
 */

export interface ConfirmationEmailTemplateInput {
  username: string;
  link: string;
  ttlHours: number;
}

const BRAND_COLOR = '#4f46e5';
const TEXT_COLOR = '#1f2430';
const MUTED_COLOR = '#6b7280';
const BORDER_COLOR = '#e5e7eb';
const SURFACE_COLOR = '#f4f5f7';

/**
 * Escapes the handful of characters that matter when interpolating
 * user-controlled text (the username) into an HTML body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderConfirmationEmailHtml({
  username,
  link,
  ttlHours,
}: ConfirmationEmailTemplateInput): string {
  const safeUsername = escapeHtml(username);
  const safeLink = escapeHtml(link);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Confirm your OpenLinker account</title>
  </head>
  <body style="margin:0; padding:0; background-color:${SURFACE_COLOR}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${SURFACE_COLOR}; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border:1px solid ${BORDER_COLOR}; border-radius:8px; overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <span style="font-size:18px; font-weight:700; color:${TEXT_COLOR}; letter-spacing:-0.01em;">OpenLinker</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <h1 style="margin:0 0 12px 0; font-size:20px; line-height:1.3; font-weight:600; color:${TEXT_COLOR};">Confirm your email address</h1>
                <p style="margin:0 0 20px 0; font-size:14px; line-height:1.6; color:${TEXT_COLOR};">
                  Hello ${safeUsername}, thanks for signing up for OpenLinker. Confirm your email address to activate your account.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:6px; background-color:${BRAND_COLOR};">
                      <a href="${safeLink}" style="display:inline-block; padding:12px 24px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:6px;">
                        Confirm your email
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:${MUTED_COLOR};">
                  Or paste this link into your browser:<br />
                  <a href="${safeLink}" style="color:${BRAND_COLOR}; word-break:break-all;">${safeLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px; border-top:1px solid ${BORDER_COLOR};">
                <p style="margin:16px 0 0 0; font-size:12px; line-height:1.6; color:${MUTED_COLOR};">
                  This link expires in ${ttlHours} hours. If you did not create this account, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
