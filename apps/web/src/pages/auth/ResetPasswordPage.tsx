import type { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ResetPasswordForm } from '../../features/auth/components/ResetPasswordForm';

export function ResetPasswordPage(): ReactElement {
  const { token } = useParams<{ token: string }>();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return (
    <section className="guest-page">
      <h1 className="guest-page__title">Set a new password</h1>
      <p className="guest-page__description">Choose a new password for your account.</p>
      <ResetPasswordForm token={token} />
    </section>
  );
}
