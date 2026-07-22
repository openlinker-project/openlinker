/**
 * ConfirmationEmailTemplate Unit Tests
 *
 * @module apps/api/src/auth/templates
 */
import { renderConfirmationEmailHtml } from './confirmation-email.template';
import { EMAIL_COLORS } from './email-layout.template';

const input = {
  username: 'demo_user',
  link: 'https://app.example.com/confirm-email/raw-token',
  ttlHours: 24,
};

describe('renderConfirmationEmailHtml', () => {
  it('renders the confirmation link as the CTA href and as a plain fallback link', () => {
    const html = renderConfirmationEmailHtml(input);

    expect(html).toContain('href="https://app.example.com/confirm-email/raw-token"');
    expect(html).toContain('Confirm your email');
    expect(html).toContain('OpenLinker');
    expect(html).toContain('expires in 24 hours');
  });

  it('greets the user by username', () => {
    const html = renderConfirmationEmailHtml(input);

    expect(html).toContain('demo_user');
  });

  it('escapes HTML-significant characters in the username', () => {
    const html = renderConfirmationEmailHtml({
      ...input,
      username: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('uses the light palette inline and ships the dark-mode override block', () => {
    const html = renderConfirmationEmailHtml(input);

    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('<meta name="color-scheme" content="light dark" />');
    expect(html).toContain(EMAIL_COLORS.light.accent);
    expect(html).toContain(EMAIL_COLORS.dark.accent);
    expect(html).toContain(EMAIL_COLORS.light.onAccent);
    expect(html).toContain(EMAIL_COLORS.dark.onAccent);
  });

  it('does not carry the legacy indigo brand color', () => {
    const html = renderConfirmationEmailHtml(input);

    expect(html.toLowerCase()).not.toContain('#4f46e5');
  });
});
