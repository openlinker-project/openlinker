/**
 * ConfirmationEmailTemplate Unit Tests
 *
 * @module apps/api/src/auth/templates
 */
import { renderConfirmationEmailHtml } from './confirmation-email.template';

describe('renderConfirmationEmailHtml', () => {
  it('renders the confirmation link as the CTA href and as a plain fallback link', () => {
    const html = renderConfirmationEmailHtml({
      username: 'demo_user',
      link: 'https://app.example.com/confirm-email/raw-token',
      ttlHours: 24,
    });

    expect(html).toContain('href="https://app.example.com/confirm-email/raw-token"');
    expect(html).toContain('Confirm your email');
    expect(html).toContain('OpenLinker');
    expect(html).toContain('expires in 24 hours');
  });

  it('greets the user by username', () => {
    const html = renderConfirmationEmailHtml({
      username: 'demo_user',
      link: 'https://app.example.com/confirm-email/raw-token',
      ttlHours: 24,
    });

    expect(html).toContain('Hello demo_user');
  });

  it('escapes HTML-significant characters in the username', () => {
    const html = renderConfirmationEmailHtml({
      username: '<script>alert(1)</script>',
      link: 'https://app.example.com/confirm-email/raw-token',
      ttlHours: 24,
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
