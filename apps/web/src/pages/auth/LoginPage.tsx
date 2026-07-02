import type { ReactElement } from 'react';
import { LoginForm } from '../../features/auth/components/LoginForm';
import { useSystemConfigQuery } from '../../features/system';

export function LoginPage(): ReactElement {
  const systemConfigQuery = useSystemConfigQuery();
  const demoMode = systemConfigQuery.data?.demoMode ?? false;

  return (
    <section className="guest-page">
      <h1 className="guest-page__title">Sign in to your account</h1>
      <p className="guest-page__description">
        Enter your credentials to access the operator workspace.
      </p>
      <LoginForm demoMode={demoMode} />
    </section>
  );
}
