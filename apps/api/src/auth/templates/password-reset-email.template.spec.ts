/**
 * PasswordResetEmailTemplate Unit Tests
 *
 * @module apps/api/src/auth/templates
 */
import { EMAIL_COLORS } from './email-layout.template';
import { renderPasswordResetEmailHtml } from './password-reset-email.template';

const input = {
  username: 'demo_user',
  link: 'https://app.example.com/reset-password/raw-token',
  ttlMinutes: 60,
};

describe('renderPasswordResetEmailHtml', () => {
  it('renders the reset link as the CTA href and as a plain fallback link', () => {
    const html = renderPasswordResetEmailHtml(input);

    expect(html).toContain('href="https://app.example.com/reset-password/raw-token"');
    expect(html).toContain('Choose a new password');
    expect(html).toContain('Reset your password');
    expect(html).toContain('expires in 60 minutes');
  });

  it('greets the user by username and escapes HTML-significant characters', () => {
    const html = renderPasswordResetEmailHtml({
      ...input,
      username: '<b>evil</b>',
    });

    expect(html).not.toContain('<b>evil</b>');
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
  });

  it('escapes HTML-significant characters in the link', () => {
    const html = renderPasswordResetEmailHtml({
      ...input,
      link: 'https://app.example.com/reset-password/tok"><img src=x>',
    });

    expect(html).not.toContain('"><img src=x>');
    expect(html).toContain('&quot;&gt;&lt;img src=x&gt;');
  });

  it('uses the light palette inline and ships the dark-mode override block', () => {
    const html = renderPasswordResetEmailHtml(input);

    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain(EMAIL_COLORS.light.accent);
    expect(html).toContain(EMAIL_COLORS.dark.accent);
    expect(html.toLowerCase()).not.toContain('#4f46e5');
  });
});
