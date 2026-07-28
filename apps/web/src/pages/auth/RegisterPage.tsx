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
import { useLocation } from 'react-router-dom';
import { RegisterForm } from '../../features/users';
import { useSystemConfigQuery } from '../../features/system';
import { isMarketingLandingTrackable } from '../../features/demo';

export function RegisterPage(): ReactElement {
  const systemConfigQuery = useSystemConfigQuery();
  const location = useLocation();
  const demoMode = systemConfigQuery.data?.demoMode ?? false;
  const showTrackingFootnote = isMarketingLandingTrackable(systemConfigQuery.data, location.search);

  return (
    <section className="guest-page">
      <h1 className="guest-page__title">{demoMode ? 'Create a demo account' : 'Request access'}</h1>
      <p className="guest-page__description">
        {demoMode
          ? "No approval needed — we'll email you a confirmation link to activate your account."
          : 'Submit your details. An admin will review and approve your account.'}
      </p>
      <RegisterForm demoMode={demoMode} showTrackingFootnote={showTrackingFootnote} />
    </section>
  );
}
