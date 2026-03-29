import type { ReactElement } from 'react';
import { LoginForm } from '../../features/auth/components/LoginForm';

export function LoginPage(): ReactElement {
  return (
    <section className="guest-page">
      <h1 className="guest-page__title">Sign in to your account</h1>
      <p className="guest-page__description">
        Enter your credentials to access the operator workspace.
      </p>
      <LoginForm />
    </section>
  );
}
