import type { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ConfirmEmailStatus } from '../../features/auth/components/ConfirmEmailStatus';
import { useMessages } from '../../shared/i18n';

export function ConfirmEmailPage(): ReactElement {
  const copy = useMessages('auth').confirmEmail;
  const { token } = useParams<{ token: string }>();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return (
    <section className="guest-page">
      <h1 className="guest-page__title">{copy.title}</h1>
      <p className="guest-page__description">{copy.description}</p>
      <ConfirmEmailStatus token={token} />
    </section>
  );
}
