/**
 * Register Page
 *
 * Guest page at /register. Wraps RegisterForm inside the guest-page layout
 * (same shell used by the login/forgot-password pages). In demo mode,
 * accounts require no admin approval but must confirm their email before
 * they can sign in (#1624).
 *
 * @module pages/auth
 */
import type { ReactElement } from 'react';
import { RegisterForm } from '../../features/users';
import { useSystemConfigQuery } from '../../features/system';

export function RegisterPage(): ReactElement {
  const systemConfigQuery = useSystemConfigQuery();
  const demoMode = systemConfigQuery.data?.demoMode ?? false;

  return (
    <section className="guest-page">
      <h1 className="guest-page__title">
        {demoMode ? 'Create a demo account' : 'Request access'}
      </h1>
      <p className="guest-page__description">
        {demoMode
          ? "No approval needed — we'll email you a confirmation link to activate your account."
          : 'Submit your details. An admin will review and approve your account.'}
      </p>
      <RegisterForm demoMode={demoMode} />
    </section>
  );
}
