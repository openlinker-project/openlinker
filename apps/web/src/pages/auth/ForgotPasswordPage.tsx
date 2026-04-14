import type { ReactElement } from 'react';
import { ForgotPasswordForm } from '../../features/auth/components/ForgotPasswordForm';

export function ForgotPasswordPage(): ReactElement {
  return (
    <section className="guest-page">
      <h1 className="guest-page__title">Forgot your password?</h1>
      <p className="guest-page__description">
        Enter your account email and we&apos;ll send you a link to reset your password.
      </p>
      <ForgotPasswordForm />
    </section>
  );
}
