import type { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ResetPasswordForm } from '../../features/auth/components/ResetPasswordForm';
import { useMessages } from '../../shared/i18n';

export function ResetPasswordPage(): ReactElement {
  const copy = useMessages('auth').resetPassword;
  const { token } = useParams<{ token: string }>();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return (
    <section className="guest-page">
      <h1 className="guest-page__title">{copy.title}</h1>
      <p className="guest-page__description">{copy.description}</p>
      <ResetPasswordForm token={token} />
    </section>
  );
}
