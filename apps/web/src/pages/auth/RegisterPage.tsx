import type { ReactElement } from 'react';
import { RegisterForm } from '../../features/users/components/register-form';

export function RegisterPage(): ReactElement {
  return (
    <section className="guest-page">
      <h1 className="guest-page__title">Request access</h1>
      <p className="guest-page__description">
        Submit your details. An admin will review and approve your account.
      </p>
      <RegisterForm />
    </section>
  );
}
