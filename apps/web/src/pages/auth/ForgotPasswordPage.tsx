import type { ReactElement } from 'react';
import { ForgotPasswordForm } from '../../features/auth/components/ForgotPasswordForm';
import { useMessages } from '../../shared/i18n';

export function ForgotPasswordPage(): ReactElement {
  const copy = useMessages('auth').forgotPassword;
  return (
    <section className="guest-page">
      <h1 className="guest-page__title">{copy.title}</h1>
      <p className="guest-page__description">{copy.description}</p>
      <ForgotPasswordForm />
    </section>
  );
}
