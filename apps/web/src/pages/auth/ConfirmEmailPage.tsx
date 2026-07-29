import type { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ConfirmEmailStatus } from '../../features/auth/components/ConfirmEmailStatus';

export function ConfirmEmailPage(): ReactElement {
  const { token } = useParams<{ token: string }>();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return (
    <section className="guest-page">
      <h1 className="guest-page__title">Confirm your email</h1>
      <p className="guest-page__description">
        We&apos;re confirming your account using the link you followed.
      </p>
      <ConfirmEmailStatus token={token} />
    </section>
  );
}
